from collections import defaultdict
from flask import Flask, flash, redirect, render_template, request, session, Response
from functools import wraps
import requests

app = Flask(__name__)
app.config.from_prefixed_env()
if not app.config.get('PLAID_URL'):
    app.config['PLAID_URL'] = 'http://localhost:8080/'
if not app.config['PLAID_URL'].endswith('/'):
    app.config['PLAID_URL'] += '/'
app.config['PLAID_URL'] += 'api/v1/'

class LoginError(Exception):
    pass

def send_request(method, path, blob=None, **data):
    token = session.get('token')
    if not token:
        flash('login required', 'auth')
        raise LoginError()
    param = blob if blob is not None else data
    r = requests.request(method, app.config['PLAID_URL'] + path,
                         json=param,
                         headers={'Authorization': 'Bearer '+token})
    if r.status_code == 401:
        flash('your session has expired; please login again', 'auth')
        raise LoginError()
    try:
        blob = r.json()
    except:
        blob = {}
    return r.status_code, blob

def require_token(fn_):
    @wraps(fn_)
    def fn(*args, **kwargs):
        try:
            return fn_(*args, **kwargs)
        except LoginError:
            return redirect('/login')
    return fn

@app.route('/login', methods=['GET', 'POST'])
def login_page():
    if request.method == 'POST':
        r = requests.post(app.config['PLAID_URL'] + 'login',
                          json={'user-id': request.form['username'],
                                'password': request.form['password']})
        if r.status_code == 200:
            session['token'] = r.json()['token']
            session['username'] = request.form['username']
            return redirect('/')
        else:
            flash('invalid username or password', 'auth')
    return render_template('login.html')

@app.get('/')
@require_token
def index():
    code, data = send_request('GET', 'projects')
    return render_template('projects.html', data=data)

@app.get('/project/<string:pid>')
@require_token
def project(pid):
    code, data = send_request('GET', 'projects/'+pid)
    if code != 200:
        # TODO
        return redirect('/')
    if 'corefud' not in data['config']:
        return render_template('project_config.html', data=data)
    code2, data2 = send_request('GET', 'projects/'+pid+'/documents')
    return render_template('project_documents.html', data=data2,
                           project=data)

def find_by_role(obj, key, role):
    if obj is None:
        return None
    for blob in obj[key]:
        if blob['config'].get('plaid', {}).get('role') == role:
            return blob

@app.post('/project/<string:pid>/configure')
@require_token
def project_config(pid):
    code, data = send_request('GET', 'projects/'+pid)
    if code != 200:
        # TODO
        return redirect('/')
    if 'corefud' in data['config']:
        return redirect('/project/'+pid)
    base = find_by_role(data, 'project/text-layers', 'baseline')
    word = find_by_role(base, 'text-layer/token-layers', 'syntactic-word')
    if word is None:
        return render_template('project_config_fail.html', data=data)
    word_layer = word['token-layer/id']
    span_code, span_data = send_request(
        'POST', 'span-layers',
        **{'token-layer-id': word_layer, 'name': 'Coref Entity'})
    span_id = span_data['id']
    send_request('PUT', 'span-layers/'+span_id+'/config/corefud/role',
                 is_id=True)
    send_request('PUT', 'projects/'+pid+'/config/corefud/configured',
                 configured=True)
    return redirect('/project/'+pid)

def token_sort_key(w):
    return (w['token/begin'], w['token/precedence'] or 0)

@app.get('/document/<string:docid>')
@require_token
def document(docid):
    code, data = send_request('GET', 'documents/'+docid+'?include-body=true')
    base = find_by_role(data, 'document/text-layers', 'baseline')
    sents = find_by_role(base, 'text-layer/token-layers', 'sentence')
    words = find_by_role(base, 'text-layer/token-layers', 'syntactic-word')
    word_data = defaultdict(lambda: defaultdict(list))
    relations = []
    coref_layer = None
    for span_layer in words['token-layer/span-layers']:
        if 'corefud' in span_layer['config']:
            coref_layer = span_layer
        if 'ud' not in span_layer['config']:
            continue
        role = None
        for k, v in span_layer['config']['ud'].items():
            if v == True:
                role = k
                break
        if role is None:
            continue
        span2word = {}
        for span in span_layer['span-layer/spans']:
            tok = span['span/tokens']
            if len(tok) == 1:
                word_data[tok[0]][role] = span['span/value']
                span2word[span['span/id']] = tok[0]
        for relation in span_layer['span-layer/relation-layers']:
            if 'ud' not in relation['config']:
                continue
            if not relation['config']['ud'].get('dependency'):
                continue
            for rel in relation['relation-layer/relations']:
                relations.append((span2word.get(rel['relation/source']),
                                  span2word.get(rel['relation/target']),
                                  rel['relation/value']))
    sentences = []
    for idx, st in enumerate(sents['token-layer/tokens'], 1):
        sa = st['token/begin']
        sz = st['token/end']
        wd = [w for w in words['token-layer/tokens']
              if sa <= w['token/begin'] <= w['token/end'] <= sz]
        wd.sort(key=token_sort_key)
        wids = set(w['token/id'] for w in wd)
        sentences.append({
            'index': idx,
            'words': [{'ID': n, 'token_id': w['token/id'],
                       **word_data.get(w['token/id'], {})}
                      for n, w in enumerate(wd, 1)],
            'relations': [r for r in relations
                          if r[0] in wids and r[1] in wids],
            'metadata': st['metadata'],
        })
    entity_names = data.get('metadata', {}).get('corefud', {}).get('entities', {})
    return render_template('document.html', sentences=sentences,
                           coref=coref_layer, entity_names=entity_names,
                           document=data)

@app.post('/span')
@require_token
def add_span():
    inp = request.get_json()
    code, data = send_request('POST', 'spans', **inp)
    return data, code

@app.delete('/span/<string:spanid>')
@require_token
def delete_span(spanid):
    code, data = send_request('DELETE', f'spans/{spanid}')
    return data, code

@app.put('/span/<string:spanid>')
@require_token
def shift_span(spanid):
    inp = request.get_json()
    code, data = send_request('PUT', f'spans/{spanid}/tokens', **inp)
    return data, code

@app.patch('/span/<string:spanid>')
@require_token
def relabel_span(spanid):
    inp = request.get_json()
    code, data = send_request('PATCH', f'spans/{spanid}', **inp)
    return data, code

@app.route('/entity', methods=['POST', 'PATCH'])
@require_token
def modify_entity():
    inp = request.get_json()
    docid = inp['document']
    code, data = send_request('GET', f'documents/{docid}')
    if code >= 300:
        return data, code
    block = data.get('metadata', {}).get('corefud', {})
    if 'entities' not in block:
        block['entities'] = {}
    entities = block['entities']
    if request.method == 'POST':
        etype = inp['type']
        if etype not in set('ptilnacves'):
            return {'error': 'bad entity type'}, 400
        if 'counts' not in block:
            block['counts'] = {}
        c = block['counts'].get(etype, 0)
        c += 1
        block['counts'][etype] = c
        eid = f'{etype}{c}'
        block['entities'][eid] = inp['name']
        code2, data2 = send_request('PATCH', f'documents/{docid}/metadata',
                                    corefud=block)
        if code2 >= 300:
            return data2, code2
        return {'id': eid, 'name': inp['name']}
    else:
        eid = inp['id']
        if eid not in entities:
            return {'error': 'no such entity id'}, 400
        name = inp['name']
        if entities[eid] != name:
            block['entities'][eid] = name
            code2, data2 = send_request(
                'PATCH', f'documents/{docid}/metadata', corefud=block)
            if code2 >= 300:
                return data2, code2
        return {'id': eid, 'name': name}

@app.route('/document/<string:docid>/upload', methods=['GET', 'POST'])
@require_token
def upload_data(docid):
    if request.method == 'GET':
        code, data = send_request('GET', f'documents/{docid}')
        return render_template('upload_form.html', data=data)
    code, data = send_request('GET', 'documents/'+docid+'?include-body=true')
    # TODO: error handling
    metadata_key = request.form['metadata']
    baseline = find_by_role(data, 'document/text-layers', 'baseline')
    sentence = find_by_role(baseline, 'text-layer/token-layers', 'sentence')
    word = find_by_role(baseline, 'text-layer/token-layers', 'syntactic-word')
    sent_ranges = []
    for sent in sentence['token-layer/tokens']:
        k = sent.get('metadata', {}).get(metadata_key)
        sent_ranges.append((k, sent['token/begin'], sent['token/end']))
    word_locs = {}
    words_by_sent = defaultdict(list)
    for w in word['token-layer/tokens']:
        sid = None
        for k, a, z in sent_ranges:
            if a <= w['token/begin'] <= w['token/end'] <= z:
                words_by_sent[k].append(w)
                break
    for k in words_by_sent:
        for i, w in enumerate(sorted(words_by_sent[k], key=token_sort_key), 1):
            word_locs[(k, i)] = w['token/id']
    coref_layer = None
    for layer in word['token-layer/span-layers']:
        if layer.get('config', {}).get('corefud', {}).get('role', {}).get('is_id'):
            coref_layer = layer['span-layer/id']
            break
    metadata = data.get('document/metadata', {}).get('corefud', {})
    counts = metadata.get('counts', {})
    names = metadata.get('entities', {})
    eid_remap = {}
    spans = []
    for row in request.files['file'].readlines():
        cols = row.decode('utf-8').strip().split('\t')
        if len(cols) != 5:
            continue
        s, a, z, e, n = cols
        tokens = []
        for i in range(int(a), int(z)+1):
            if (s, i) in word_locs:
                tokens.append(word_locs[(s, i)])
        if not tokens:
            continue
        if e not in eid_remap:
            counts[e[0]] = counts.get(e[0], 0) + 1
            eid_remap[e] = e[0] + str(counts[e[0]])
        e2 = eid_remap[e]
        names[e2] = n
        spans.append({
            'span-layer-id': coref_layer,
            'tokens': tokens,
            'value': e2,
        })
    metadata['counts'] = counts
    metadata['entities'] = names
    send_request('PATCH', f'documents/{docid}/metadata', corefud=metadata)
    send_request('POST', 'spans/bulk', blob=spans)
    return redirect(f'/document/{docid}')

@app.get('/document/<string:docid>/download')
@require_token
def download_data(docid):
    if 'metadata' not in request.args:
        code, data = send_request('GET', f'documents/{docid}')
        return render_template('download_form.html', data=data)
    code, data = send_request('GET', 'documents/'+docid+'?include-body=true')
    # TODO: error handling
    metadata_key = request.args['metadata']
    baseline = find_by_role(data, 'document/text-layers', 'baseline')
    sentence = find_by_role(baseline, 'text-layer/token-layers', 'sentence')
    word = find_by_role(baseline, 'text-layer/token-layers', 'syntactic-word')
    sent_ranges = []
    for sent in sentence['token-layer/tokens']:
        k = sent.get('metadata', {}).get(metadata_key)
        sent_ranges.append((k, sent['token/begin'], sent['token/end']))
    word_locs = {}
    words_by_sent = defaultdict(list)
    for w in word['token-layer/tokens']:
        sid = None
        for k, a, z in sent_ranges:
            if a <= w['token/begin'] <= w['token/end'] <= z:
                words_by_sent[k].append(w)
                break
    for k in words_by_sent:
        for i, w in enumerate(sorted(words_by_sent[k], key=token_sort_key), 1):
            word_locs[w['token/id']] = (k, i)
    coref_layer = None
    for layer in word['token-layer/span-layers']:
        if layer.get('config', {}).get('corefud', {}).get('role', {}).get('is_id'):
            coref_layer = layer
            break
    metadata = data.get('metadata', {}).get('corefud', {})
    names = metadata.get('entities', {})
    ret = ''
    for span in coref_layer['span-layer/spans']:
        sents = set()
        words = set()
        skip = False
        for t in span['span/tokens']:
            if t not in word_locs:
                skip = True
                break
            else:
                sents.add(word_locs[t][0])
                words.add(word_locs[t][1])
        if skip or len(sents) > 1:
            continue
        wa = min(words)
        wz = max(words)
        if words != set(range(wa, wz+1)):
            # we don't support discontinuous spans in this version
            continue
        k = list(sents)[0]
        e = span['span/value']
        n = names.get(e, e).replace('\t', ' ').replace('\n', ' ')
        ret += f'{k}\t{wa}\t{wz}\t{e}\t{n}\n'
    return Response(ret, mimetype='text/tsv')
