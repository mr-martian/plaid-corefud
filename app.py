from collections import defaultdict, Counter
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

def nested_get(blob, *keys):
    ret = blob
    for k in keys:
        ret = ret.get(k, {})
    return ret

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
    return blob, r.status_code

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
    data, code = send_request('GET', 'projects')
    return render_template('projects.html', data=data)

@app.get('/project/<string:pid>')
@require_token
def project(pid):
    data, code = send_request('GET', 'projects/'+pid)
    if code != 200:
        # TODO
        return redirect('/')
    if 'corefud' not in data['config']:
        return render_template('project_config.html', data=data)
    data2, code2 = send_request('GET', 'projects/'+pid+'/documents')
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
    data, code = send_request('GET', 'projects/'+pid)
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
    span_data, span_code = send_request(
        'POST', 'span-layers',
        **{'token-layer-id': word_layer,
           'name': 'Coreference Entities and Mentions'})
    span_id = span_data['id']
    send_request('PUT', 'span-layers/'+span_id+'/config/corefud/role',
                 blob='entity')
    rel_data, rel_code = send_request(
        'POST', 'relation-layers',
        **{'span-layer-id': span_id,
           'name': 'Coreference Entity to Mention'})
    rel_id = rel_data['id']
    send_request('PUT', 'relation-layers/'+rel_id+'/config/corefud/role',
                 blob='mention')
    send_request('PUT', 'projects/'+pid+'/config/corefud/configured',
                 blob=True)
    return redirect('/project/'+pid)

def get_layers(document):
    base = find_by_role(document, 'document/text-layers', 'baseline')
    sents = find_by_role(base, 'text-layer/token-layers', 'sentence')
    words = find_by_role(base, 'text-layer/token-layers', 'syntactic-word')
    entities = None
    mentions = None
    for sl in words['token-layer/span-layers']:
        if nested_get(sl, 'config', 'corefud', 'role') == 'entity':
            entities = sl
            for rl in sl['span-layer/relation-layers']:
                if nested_get(rl, 'config', 'corefud', 'role') == 'mention':
                    mentions = rl
                    break
            break
    return sents, words, entities, mentions

def token_sort_key(w):
    return (w['token/begin'], w['token/precedence'] or 0)

def index_words(sents, words):
    metadata_key = 'sent_id'
    sent_ranges = []
    for sent in sents['token-layer/tokens']:
        k = sent.get('metadata', {}).get(metadata_key)
        sent_ranges.append((k, sent['token/begin'], sent['token/end']))
    loc2word = {}
    word2loc = {}
    words_by_sent = defaultdict(list)
    for w in words['token-layer/tokens']:
        sid = None
        for k, a, z in sent_ranges:
            if a <= w['token/begin'] <= w['token/end'] <= z:
                words_by_sent[k].append(w)
                break
    for k in words_by_sent:
        for i, w in enumerate(sorted(words_by_sent[k], key=token_sort_key), 1):
            loc2word[(k, i)] = w['token/id']
            word2loc[w['token/id']] = (k, i)
    return loc2word, word2loc

@app.get('/document/<string:docid>')
@require_token
def document(docid):
    data, code = send_request('GET', 'documents/'+docid+'?include-body=true')
    sents, words, coref_layer, mention_layer = get_layers(data)
    word_data = defaultdict(lambda: defaultdict(list))
    relations = []
    for span_layer in words['token-layer/span-layers']:
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
    return render_template('document.html', sentences=sentences,
                           coref=coref_layer, mentions=mention_layer,
                           document=data,
                           all_tokens=[w['token/id'] for w in words['token-layer/tokens']])

@app.post('/span')
@require_token
def add_span():
    print('/span', request.get_json())
    return send_request('POST', 'spans', **request.get_json())

@app.delete('/span/<string:spanid>')
@require_token
def delete_span(spanid):
    return send_request('DELETE', f'spans/{spanid}')

@app.put('/span/<string:spanid>')
@require_token
def shift_span(spanid):
    return send_request('PUT', f'spans/{spanid}/tokens',
                        **request.get_json())

@app.patch('/span/<string:spanid>/metadata')
@require_token
def relabel_span(spanid):
    return send_request('PATCH', f'spans/{spanid}/metadata',
                        blob=request.get_json())

@app.post('/relations')
@require_token
def add_relation():
    print('/relation', request.get_json())
    return send_request('POST', 'relations', **request.get_json())

@app.put('/relations/<string:relationid>')
@require_token
def shift_relation(relationid):
    return send_request('PUT', f'relations/{relationid}/source',
                        **request.get_json())

@app.route('/document/<string:docid>/upload', methods=['GET', 'POST'])
@require_token
def upload_data(docid):
    if request.method == 'GET':
        data, code = send_request('GET', f'documents/{docid}')
        return render_template('upload_form.html', data=data)
    data, code = send_request('GET', 'documents/'+docid+'?include-body=true')
    sentence, word, coref_layer, mention_layer = get_layers(data)
    word_locs = index_words(sentence, word)[0]
    all_tokens = [w['token/id'] for w in word['token-layer/tokens']]
    # TODO: error handling
    eid_index = {}
    spans = []
    pairs = []
    entity_types = {
        'p': 'person',
        't': 'time',
        'i': 'object',
        'l': 'place',
        'n': 'organization',
        'a': 'abstract',
        'c': 'animal',
        'v': 'plant',
        'e': 'event',
        's': 'substance',
    }
    for row in request.files['file'].readlines():
        cols = row.decode('utf-8').strip().split('\t')
        if len(cols) != 5:
            continue
        if cols == ['key', 'start', 'end', 'eid', 'name']:
            continue
        s, a, z, e, n = cols
        tokens = []
        for i in range(int(a), int(z)+1):
            if (s, i) in word_locs:
                tokens.append(word_locs[(s, i)])
        if not tokens:
            continue
        if e not in eid_index:
            eid_index[e] = len(spans)
            spans.append({
                'span-layer-id': coref_layer['span-layer/id'],
                'tokens': all_tokens,
                'value': '',
                'metadata': {
                    'abstract': True,
                    'name': n,
                    'type': entity_types.get(e[0], 'unknown'),
                },
            })
        pairs.append((eid_index[e], len(spans)))
        spans.append({
            'span-layer-id': coref_layer['span-layer/id'],
            'tokens': tokens,
            'value': '',
            'metadata': {
                'abstract': False,
            },
        })
    span_data, span_code = send_request('POST', 'spans/bulk', blob=spans)
    relations = [
        {'relation-layer-id': mention_layer['relation-layer/id'],
         'source': span_data['ids'][p[0]],
         'target': span_data['ids'][p[1]],
         'value': ''}
        for p in pairs]
    send_request('POST', 'relations/bulk', blob=relations)
    return redirect(f'/document/{docid}')

@app.get('/document/<string:docid>/download')
@require_token
def download_data(docid):
    data, code = send_request('GET', 'documents/'+docid+'?include-body=true')
    # TODO: error handling
    sentence, word, coref_layer, mention_layer = get_layers(data)
    word_locs = index_words(sentence, word)[1]
    mention_spans = []
    entities = {}
    span2ent = {}
    for rel in mention_layer['relation-layer/relations']:
        span2ent[rel['relation/target']] = rel['relation/source']
    for span in coref_layer['span-layer/spans']:
        if nested_get(span, 'metadata', 'abstract'):
            entities[span['span/id']] = span['metadata']
            continue
        if span['span/id'] not in span2ent:
            continue
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
        mention_spans.append((k, wa, wz, span2ent[span['span/id']]))
    mention_spans.sort()
    entity_types = {
        'person': 'p',
        'time': 't',
        'object': 'i',
        'place': 'l',
        'organization': 'n',
        'abstract': 'a',
        'animal': 'c',
        'plant': 'v',
        'event': 'e',
        'substance': 's',
    }
    ret = 'key\tstart\tend\teid\tname\n'
    enum = Counter()
    eindex = {}
    for k, wa, wz, eid in mention_spans:
        if eid not in entities:
            continue
        if eid not in eindex:
            etype = entity_types.get(entities[eid].get('type'), 'u')
            enum[etype] += 1
            eindex[eid] = etype + str(enum[etype])
        name = ' '.join(entities[eid].get('name', '_').split())
        ret += f'{k}\t{wa}\t{wz}\t{eindex[eid]}\t{name}\n'
    fname = data['document/name'].replace('/', '.').replace(' ', '_')
    return Response(ret, mimetype='text/tsv',
                    headers={'Content-Disposition':
                             f'attachment; filename={fname}.tsv'})
