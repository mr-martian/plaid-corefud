var COREF_ENTITIES = {};
var COREF_MENTIONS = {};
const DIALOG = document.getElementById('dialog');
const DIALOG_MODE = document.getElementById('dialog-mode');
const DIALOG_EXISTING = document.getElementById('existing-entity');
const DIALOG_NEW_NAME = document.getElementById('entity-name');
const DIALOG_NEW_TYPE = document.getElementById('entity-type');

function arc_path(baseline, head, dep, height) {
  let d = (head < dep) ? +0.2 : -0.2;
  return `M ${head} ${baseline}
L ${head + d*height} ${baseline - height}
L ${dep - d*height} ${baseline - height}
L ${dep} ${baseline}`;
}

function arc_head(baseline, dep) {
  let s = 'M '+dep + ' ' + baseline + ' ';
  s += 'L ' + (dep - 6) + ' ' + (baseline - 10) + ' ';
  s += 'L ' + (dep + 6) + ' ' + (baseline - 10) + ' Z';
  return s;
}

var WORD_LOCS = {};

function draw_sentence(elem, swap) {
  const blob = JSON.parse(elem.dataset.sent);
  let meta_ls = elem.querySelector('dl.sentence-metadata');
  meta_ls.innerHTML = '';
  for (let k in blob.metadata) {
    meta_ls.innerHTML += `<dt>${k}</dt><dd>${blob.metadata[k]}</dd>`;
  }
  let svg = elem.querySelector('svg');
  svg.innerHTML = '';
  let table = elem.querySelector('div.sentence-data');
  table.innerHTML = '';
  let w_order = blob.words.slice();
  if (swap) {
    w_order.reverse();
  }
  w_order.forEach((w, idx) => {
    WORD_LOCS[w.token_id] = {elem: table, col: idx+1};
    let block = table.appendChild(document.createElement('div'));
    block.className = 'word';
    block.style['grid-column'] = (idx+1);
    block.style['grid-row'] = 1;
    block.innerHTML = `<b>${w.ID}</b><br/>${w.lemma}<br/>${w.upos}`;
    block.dataset.id = w.token_id;
    let b2 = table.appendChild(document.createElement('div'));
    b2.className = 'word-data';
    b2.style['grid-column'] = (idx+1);
    b2.style['grid-row'] = 2;
    b2.innerHTML = ('<details><summary>Features</summary><dl>' +
                    Array.from(Object.keys(w)).map(
                      (k) => {
                        if (k == 'ID' || k == 'lemma' || k == 'upos' || k == 'token_id') {
                          return '';
                        }
                        return `<dt>${k}</dt><dd>${w[k]}</dd>`;
                      }).join('') + '</dl></details>');
  });
}

function draw_arcs(sentence) {
  const blob = JSON.parse(sentence.dataset.sent);
  let svg = sentence.querySelector('svg');
  svg.innerHTML = '';
  let table = sentence.querySelector('div.sentence-data');
  let offset = svg.getBoundingClientRect().left;
  let centers = Array.from(table.querySelectorAll('.word')).map(
	  function(w) {
	    let r = w.getBoundingClientRect();
	    return ((r.left + r.right) / 2) - offset;
	  });
  let root_pos = null;
  let max_height = 100;
  let arcs = [];
  blob.relations.forEach(r => {
    let c0 = centers[WORD_LOCS[r[0]].col - 1];
    let c1 = centers[WORD_LOCS[r[1]].col - 1];
    if (r[0] == r[1]) {
      root_pos = c0;
    } else {
      let height = 10*(Math.sqrt(Math.abs(c0 - c1)) - 1);
      arcs.push({height: height, head: c0, dep: c1, label: r[2]});
      if (height > max_height) {
        max_height = height;
      }
    }
  });
  let baseline = max_height+40;
  svg.setAttribute('width', table.scrollWidth);
  svg.setAttribute('height', max_height+40);
  svg.innerHTML = arcs.map(
	  function(arc) {
	    let label = arc.label;
	    if (arc.head < arc.dep) {
		    label += '&gt;';
	    } else {
		    label = '&lt;' + label;
	    }
	    return `
<g stroke="black" fill="none">
  <path d="${arc_path(baseline, arc.head, arc.dep, arc.height)}"/>
  <path d="${arc_head(baseline, arc.dep)}"/>
  <text x="${(arc.head+arc.dep)/2 - 2*label.length}" y="${baseline - arc.height - 15}" transform="rotate(-20,${(arc.head+arc.dep)/2},${baseline - arc.height - 20})">${label}</text>
</g>`;
	  }
  ).join('');
}

function coref_label(eid) {
  if (COREF_MENTIONS.hasOwnProperty(eid)) {
    const e = COREF_ENTITIES[COREF_MENTIONS[eid].entity];
    if (e && e.metadata) {
      return `${e.metadata.name} (${e.metadata.type})`;
    }
  }
  return '_';
}

function draw_coref(entry) {
  if (entry.metadata && entry.metadata['abstract']) {
    return;
  }
  let cols = entry['span/tokens'].map(x => WORD_LOCS[x].col);
  if (cols.length > 0) {
    let start = Math.min(...cols);
    let end = Math.max(...cols);
    let node = WORD_LOCS[entry['span/tokens'][0]].elem.appendChild(
      document.createElement('div'));
    node.className = 'coref-span';
    node.dataset.nodes = JSON.stringify(entry['span/tokens']);
    node.dataset.id = entry['span/id'];
    if (COREF_MENTIONS.hasOwnProperty(entry['span/id'])) {
      node.dataset.entity = COREF_MENTIONS[entry['span/id']].entity;
    }
    node.innerText = coref_label(entry['span/id']);
    node.style['grid-column-start'] = start;
    node.style['grid-column-end'] = end + 1;
  }
}

function draw_trees() {
  WORD_LOCS = {};
  const swap = document.getElementById('text-direction').checked;
  document.querySelectorAll('.sentence').forEach(
    s => draw_sentence(s, swap));
  COREF_SPANS.forEach(draw_coref);
  document.querySelectorAll('.sentence').forEach(draw_arcs);
}

function check_buttons(sentence, select_mention) {
  const has_word = (sentence.querySelector('.word.selected') !== null);
  const mention = sentence.querySelector('.coref-span.selected');
  const has_mention = (mention !== null);
  sentence.querySelector('.btn-add').toggleAttribute('disabled', !has_word);
  sentence.querySelector('.btn-del').toggleAttribute('disabled', !has_mention);
  sentence.querySelector('.btn-shift').toggleAttribute('disabled', (!has_word || !has_mention));
  sentence.querySelector('.btn-change').toggleAttribute('disabled', !has_mention);
  sentence.querySelector('.btn-rename').toggleAttribute('disabled', !has_mention);
}

// equality of sorted arrays
function array_eq(a, b) {
  if (a.length != b.length) {
    return false;
  }
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) {
      return false;
    }
  }
  return true;
}

function same_words(coref, words) {
  return array_eq(words, JSON.parse(coref.dataset.nodes).toSorted());
}

function selected_words(sentence) {
  let id_list = Array.from(sentence.querySelectorAll(
    '.word.selected')).map(w => w.dataset.id);
  id_list.sort();
  return id_list;
}

async function handle_click(event) {
  if (event.target === null) {
    return;
  }
  const cls = event.target.classList;
  const sentence = event.target.closest('.sentence');
  if (sentence !== null) {
    document.querySelectorAll('.sentence.current').forEach(
      s => s.classList.remove('current'));
    sentence.classList.toggle('current');
  }
  if (cls.contains('btn-add')) {
    let id_list = selected_words(sentence);
    if (!id_list.length) {
      return;
    }
    for (let c of sentence.querySelectorAll('.coref-span')) {
      if (same_words(c, id_list)) {
        return;
      }
    }
    DIALOG_MODE.value = 'add';
    DIALOG.showModal();
  } else if (cls.contains('btn-del')) {
    let coref = sentence.querySelector('.coref-span.selected');
    if (coref !== null && coref.dataset.id) {
      fetch(`/span/${coref.dataset.id}`, {method: 'DELETE'}).then(resp => {
        if (resp.ok) {
          COREF_SPANS = COREF_SPANS.filter(
            s => (s['span/id'] !== coref.dataset.id));
          coref.remove();
          check_buttons(sentence);
        }
      });
    }
  } else if (cls.contains('btn-shift')) {
    let coref = sentence.querySelector('.coref-span.selected');
    let words = selected_words(sentence);
    if (!words.length || coref === null || same_words(coref, words)) {
      return;
    }
    fetch(`/span/${coref.dataset.id}`, {
      method: 'PUT',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({tokens: words}),
    }).then(resp => {
      if (resp.ok) {
        for (let k = 0; k < COREF_SPANS.length; k++) {
          if (COREF_SPANS[k]['span/id'] == coref.dataset.id) {
            COREF_SPANS[k]['span/tokens'] = words;
            draw_coref(COREF_SPANS[k]);
          }
        }
        coref.remove();
        draw_arcs(sentence);
        check_buttons(sentence);
      }
    });
  } else if (cls.contains('btn-change')) {
    let coref = sentence.querySelector('.coref-span.selected');
    if (coref === null) {
      return;
    }
    DIALOG_MODE.value = 'change';
    DIALOG.showModal();
  } else if (cls.contains('btn-rename')) {
    let coref = sentence.querySelector('.coref-span.selected');
    if (coref === null) {
      return;
    }
    DIALOG_MODE.value = 'rename';
    DIALOG.showModal();
  } else {
    let word = event.target.closest('.word');
    let coref = event.target.closest('.coref-span');
    if (word !== null) {
      word.classList.toggle('selected');
      if (event.shiftKey) {
        let last = Array.from(document.getElementsByClassName('last-clicked'));
        if (last.length == 1 && last[0].closest('.sentence') === sentence) {
          let toggle = false;
          Array.from(sentence.getElementsByClassName('word')).forEach(
            w => {
              if (w === word || w === last[0]) {
                toggle = !toggle;
              } else if (toggle) {
                w.classList.add('selected');
              }
            });
        }
      }
      Array.from(document.getElementsByClassName('last-clicked')).forEach(
        w => w.classList.remove('last-clicked'));
      word.classList.add('last-clicked');
      check_buttons(sentence);
    } else if (coref !== null) {
      if (!coref.classList.contains('selected')) {
        let sent = coref.closest('.sentence-data');
        Array.from(sent.querySelectorAll('.selected')).forEach(
          (e) => e.classList.remove('selected'));
        JSON.parse(coref.dataset.nodes).forEach(
          wid => sent.querySelector(`div.word[data-id="${wid}"]`).classList.add('selected'));
      }
      coref.classList.toggle('selected');
      check_buttons(sentence, true);
    }
  }
}

function update_entity_select() {
  let ops = [];
  for (const k in COREF_ENTITIES) {
    const v = COREF_ENTITIES[k].metadata;
    const label = `${v.name} (${v.type})`
    ops.push([label, `<option value="${k}">${label}</option>`])
  }
  ops.sort();
  DIALOG_EXISTING.innerHTML = ops.map(x => x[1]).join();
  DIALOG_EXISTING.dispatchEvent(new Event("chosen:updated"));
}

window.addEventListener('load', (event) => {
  COREF_SPANS.forEach(s => {
    if (s.metadata && s.metadata['abstract']) {
      COREF_ENTITIES[s['span/id']] = s;
    }
  });
  MENTIONS.forEach(m => {
    COREF_MENTIONS[m['relation/target']] = {
      entity: m['relation/source'],
      relation: m['relation/id'],
    };
  });
  draw_trees();
  document.addEventListener('click', handle_click);
  update_entity_select();
});

window.addEventListener('keypress', (event) => {
  if (event.target.tagName == 'INPUT') {
    return;
  }
  if (event.key === 'a') {
    handle_click({
      target: document.querySelector('.sentence.current .btn-add'),
    });
  } else if (event.key === 'd') {
    handle_click({
      target: document.querySelector('.sentence.current .btn-del'),
    });
  } else if (event.key === 's') {
    handle_click({
      target: document.querySelector('.sentence.current .btn-shift'),
    });
  } else if (event.key === 'e') {
    handle_click({
      target: document.querySelector('.sentence.current .btn-change'),
    });
  } else if (event.key === 'r') {
    handle_click({
      target: document.querySelector('.sentence.current .btn-rename'),
    });
  }
  console.log(event);
});

async function get_entity_id() {
  if (DIALOG_NEW_NAME.value) {
    const md = {
      'abstract': true,
      name: DIALOG_NEW_NAME.value,
      type: DIALOG_NEW_TYPE.value,
    };
    const resp = await fetch('/span', {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({
        tokens: ALL_TOKENS,
        'span-layer-id': LAYER_ID,
        value: '',
        metadata: md,
      })});
    if (resp.ok) {
      const data = await resp.json();
      COREF_ENTITIES[data.id] = {
        'span/id': data.id,
        'metadata': md,
      };
      update_entity_select();
      return data.id;
    }
    return null;
  }
  return DIALOG_EXISTING.value;
}

async function handle_dialog_confirm(sentence) {
  if (DIALOG_MODE.value === 'add') {
    const id_list = selected_words(sentence);
    const eid = await get_entity_id();
    if (!eid) {
      return;
    }
    fetch('/span', {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({
        tokens: id_list,
        'span-layer-id': LAYER_ID,
        value: '',
      })}).then(resp => resp.json()).then(data => {
        let span = {
          'span/id': data.id,
          'span/tokens': id_list,
          'span/value': '',
        };
        fetch('/relations', {
          method: 'POST',
          headers: {'Content-Type': 'application/json'},
          body: JSON.stringify({
            'layer-id': RELATION_LAYER_ID,
            'source-id': eid,
            'target-id': data.id,
            value: '',
          }),
        }).then(resp => resp.json()).then(data2 => {
          COREF_SPANS.push(span);
          COREF_MENTIONS[data.id] = {
            entity: eid,
            relation: data2.id,
          };
          draw_coref(span);
          draw_arcs(sentence);
          Array.from(sentence.querySelectorAll('.word.selected')).forEach(
            w => w.classList.remove('selected'));
        });
      });
  } else if (DIALOG_MODE.value == 'change') {
    console.log('hi');
    const coref = sentence.querySelector('.coref-span.selected');
    if (coref === null) {
      return;
    }
    console.log(coref);
    const mention = COREF_MENTIONS[coref.dataset.id];
    const eid = await get_entity_id();
    console.log(mention);
    console.log(eid);
    if (!eid) {
      return;
    }
    console.log(mention);
    if (mention) {
      fetch('/relations/'+mention.relation, {
        method: 'PUT',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({
          'span-id': eid,
        }),
      }).then(resp => resp.json()).then(data => {
        COREF_MENTIONS[coref.dataset.id].entity = eid;
        coref.innerText = coref_label(coref.dataset.id);
        coref.dataset.entity = eid;
        draw_arcs(sentence);
      });
    } else {
      fetch('/relations', {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({
          'layer-id': RELATION_LAYER_ID,
          'source-id': eid,
          'target-id': coref.dataset.id,
          value: '',
        }),
      }).then(resp => resp.json()).then(data => {
        COREF_MENTIONS[coref.dataset.id] = {
          entity: eid,
          relation: data.id,
        };
        coref.innerText = coref_label(coref.dataset.id);
        coref.dataset.entity = eid;
        draw_arcs(sentence);
      });
    }
  } else if (DIALOG_MODE.value == 'rename') {
    const name = DIALOG_NEW_NAME.value;
    const type = DIALOG_NEW_TYPE.value;
    const coref = sentence.querySelector('.coref-span.selected');
    console.log(name, type, coref);
    if (coref === null) {
      return;
    }
    const mention = COREF_MENTIONS[coref.dataset.id];
    if (name && mention) {
      fetch('/span/'+mention.entity+'/metadata', {
        method: 'PATCH',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify([
          {op: 'set', path: ['name'], value: name},
          {op: 'set', path: ['type'], value: type},
        ]),
      }).then(resp => {
        COREF_ENTITIES[mention.entity].metadata.name = name;
        COREF_ENTITIES[mention.entity].metadata.type = type;
        const new_label = `${name} (${type})`;
        Array.from(document.querySelectorAll(
          `.coref-span[data-entity="${mention.entity}"]`)).forEach(
            s => { s.innerText = new_label; });
        update_entity_select();
        Array.from(document.getElementsByClassName('sentence')).forEach(
          draw_arcs);
      });
    }
  }
}

DIALOG.addEventListener('close', () => {
  const sentence = document.querySelector('.sentence.current');
  if (sentence !== null && DIALOG.returnValue === 'confirm') {
    handle_dialog_confirm(sentence);
  }
  DIALOG_NEW_NAME.value = '';
});
