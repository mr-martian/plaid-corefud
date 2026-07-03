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
  elem.innerHTML = '';
  let meta = elem.appendChild(document.createElement('details'));
  let sum = meta.appendChild(document.createElement('summary'));
  sum.innerText = 'Metadata';
  let meta_ls = meta.appendChild(document.createElement('dl'));
  for (let k in blob.metadata) {
    meta_ls.innerHTML += `<dt>${k}</dt><dd>${blob.metadata[k]}</dd>`;
  }
  let svg = elem.appendChild(document.createElementNS(
	  'http://www.w3.org/2000/svg', 'svg'));
  let table = elem.appendChild(document.createElement('div'));
  table.className = 'sentence-data';
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
  svg.setAttribute('width', table.getBoundingClientRect().width);
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

function draw_coref(entry) {
  let cols = entry['span/tokens'].map(x => WORD_LOCS[x].col);
  if (cols.length > 0) {
    let start = Math.min(...cols);
    let end = Math.max(...cols);
    let node = WORD_LOCS[entry['span/tokens'][0]].elem.appendChild(
      document.createElement('div'));
    node.className = 'coref-span';
    const eid = entry['span/value'];
    if (COREF_ENTITIES.hasOwnProperty(eid)) {
      node.innerText = `${COREF_ENTITIES[eid]} (${eid})`;
    } else {
      node.innerText = eid;
    }
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

draw_trees();
