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
  let controls = elem.querySelector('div.controls');
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
  if (COREF_ENTITIES.hasOwnProperty(eid)) {
    return `${COREF_ENTITIES[eid]} (${eid})`;
  } else {
    return eid;
  }
}

function draw_coref(entry) {
  let cols = entry['span/tokens'].map(x => WORD_LOCS[x].col);
  if (cols.length > 0) {
    let start = Math.min(...cols);
    let end = Math.max(...cols);
    let node = WORD_LOCS[entry['span/tokens'][0]].elem.appendChild(
      document.createElement('div'));
    node.className = 'coref-span';
    node.dataset.nodes = JSON.stringify(entry['span/tokens']);
    node.dataset.id = entry['span/id'];
    node.dataset.value = entry['span/value'];
    const eid = entry['span/value'];
    node.innerText = coref_label(eid);
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
  const name_field = sentence.querySelector('.entity-name');
  if (!has_mention) {
    name_field.value = '';
  } else if (has_mention && select_mention) {
    const v = mention.dataset.value;
    if (COREF_ENTITIES.hasOwnProperty(v)) {
      name_field.value = COREF_ENTITIES[v];
    } else {
      name_field.value = v;
    }
  }
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

async function get_entity_id(label, etype) {
  for (let k in COREF_ENTITIES) {
    if (k[0] == etype && COREF_ENTITIES[k] == label) {
      return k;
    }
  }
  const resp = await fetch('/entity', {
    method: 'POST',
    headers: {'Content-Type': 'application/json'},
    body: JSON.stringify({
      document: DOCUMENT_ID,
      type: etype,
      name: label,
    }),
  });
  if (resp.ok) {
    const data = await resp.json();
    COREF_ENTITIES[data.id] = data.name;
    const dl = document.getElementById('entities');
    const op = dl.appendChild(document.createElement('option'));
    op.dataset.id = data.id;
    op.innerText = data.name;
    return data.id;
  }
  return label;
}

function selected_words(sentence) {
  let id_list = Array.from(sentence.querySelectorAll(
    '.word.selected')).map(w => w.dataset.id);
  id_list.sort();
  return id_list;
}

async function handle_click(event) {
  const cls = event.target.classList;
  const sentence = event.target.closest('.sentence');
  if (cls.contains('btn-add')) {
    let label = sentence.querySelector('.entity-name').value;
    if (!label.length) {
      return;
    }
    let etype = sentence.querySelector('.entity-type').value;
    let id_list = selected_words(sentence);
    if (!id_list.length) {
      return;
    }
    for (let c of sentence.querySelectorAll('.coref-span')) {
      if (same_words(c, id_list)) {
        return;
      }
    }
    let value = await get_entity_id(label, etype);
    fetch('/span', {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({
        tokens: id_list,
        'span-layer-id': LAYER_ID,
        value: value,
      })}).then(resp => resp.json()).then(data => {
        let span = {
          'span/id': data.id,
          'span/tokens': id_list,
          'span/value': value,
        };
        COREF_SPANS.push(span);
        draw_coref(span);
        Array.from(sentence.querySelectorAll('.word.selected')).forEach(
          w => w.classList.remove('selected'));
      });
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
        check_buttons(sentence);
      }
    });
  } else if (cls.contains('btn-change')) {
    let coref = sentence.querySelector('.coref-span.selected');
    if (coref === null) {
      return;
    }
    let label = sentence.querySelector('.entity-name').value;
    if (!label.length) {
      return;
    }
    let etype = sentence.querySelector('.entity-type').value;
    let value = await get_entity_id(label, etype);
    fetch(`/span/${coref.dataset.id}`, {
      method: 'PATCH',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({value: value}),
    }).then(resp => {
      if (resp.ok) {
        coref.innerText = coref_label(value);
      }
    });
  } else if (cls.contains('btn-rename')) {
    let coref = sentence.querySelector('.coref-span.selected');
    if (coref === null) {
      return;
    }
    let name = sentence.querySelector('.entity-name').value;
    if (COREF_ENTITIES[coref.dataset.id] !== name) {
      fetch('/entity', {
        method: 'PATCH',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({
          document: DOCUMENT_ID,
          id: coref.dataset.value,
          name: name,
        })}).then(async function(resp) {
          if (resp.ok) {
            let data = await resp.json();
            COREF_ENTITIES[data.id] = data.name;
            let label = coref_label(data.id);
            Array.from(document.querySelectorAll(
              `.coref-span[data-value="${data.id}"]`)).forEach(
                s => { s.innerText = label; });
            let op = document.querySelector(`#entities option[data-id="${data.id}"]`);
            if (op !== null) {
              op.innerText = data.name;
            }
          }
        });
    }
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

window.addEventListener('load', (event) => {
  draw_trees();
  document.addEventListener('click', handle_click);
});
