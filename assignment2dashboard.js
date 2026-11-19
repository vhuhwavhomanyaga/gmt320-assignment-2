/*data loading*/

/*Renaming the provinces */

const PROVINCE_NAMES = {
  EC: 'Eastern Cape', FS: 'Free State', GP: 'Gauteng', GT: 'Gauteng', KZN: 'KwaZulu-Natal',
  LIM: 'Limpopo', LP: 'Limpopo', MP: 'Mpumalanga', NC: 'Northern Cape', NW: 'North West',
  WC: 'Western Cape'
};
let records = [];

const provinceName = code => PROVINCE_NAMES[code] || code;

function parseCSV(text) {
  const rows = []; let row = [], cell = '', inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"' && text[i + 1] === '"') { cell += '"'; i++; }
      else if (ch === '"') inQuotes = false;
      else cell += ch;
    } else if (ch === '"') inQuotes = true;
    else if (ch === ',') { row.push(cell); cell = ''; }
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      row.push(cell); rows.push(row); row = []; cell = '';
    } else cell += ch;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  return rows.filter(r => r.length > 1);
}

/*Changing the age group column */
function normaliseAge(label) {
  const m = label.match(/\[(\d+),\s*(\d+)\)/);
  if (!m) return label;
  const lo = Number(m[1]), hi = Number(m[2]);
  return hi >= 100 ? `${lo}+` : `${lo}-${hi - 1}`;
}

async function loadData(url = 'data/Province_MedianIncome_Youth_Sex.csv') {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Could not load ${url} (HTTP ${res.status})`);
  const rows = parseCSV((await res.text()).replace(/^\uFEFF/, ''));
  if (!rows.length) throw new Error('The CSV file is empty');
  const head = rows[0].map(h => h.trim().toLowerCase());
  const col = (...names) => head.findIndex(h => names.some(n => h.startsWith(n)));
  const c = { prov: col('province'), year: col('taxyear', 'year'), age: col('youth', 'agegroup'),
              sex: col('sex'), inc: col('median'), fte: col('fte') };
  if (Object.values(c).includes(-1)) throw new Error('CSV headers not recognised: ' + head.join(', '));

  /* Cleaning null values and renaming the provinces */
  records = rows.slice(1).map(r => {
    const province = (r[c.prov] || '').trim();
    const ageLabel = (r[c.age] || '').trim();
    return {
      province,
      year: Number(r[c.year]),
      age: ageLabel ? normaliseAge(ageLabel) : '',
      sex: (r[c.sex] || '').trim(),
      income: Number(r[c.inc]),
      fte: Number(r[c.fte])
    };
  }).filter(r => r.province &&
                 r.province !== 'Unknown Location - Head Office Anomaly' &&
                 r.age && Number.isFinite(r.year) &&
                 Number.isFinite(r.income) && Number.isFinite(r.fte) &&
                 r.income > 0 && r.fte > 0);

  if (!records.length) throw new Error('The CSV contains no valid dashboard records');

  return records;
}

/* Summary statistics */
const sumFte = rows => rows.reduce((total, r) => total + r.fte, 0);
function weightedIncome(rows) {
  const w = sumFte(rows);
  return w ? rows.reduce((total, r) => total + r.income * r.fte, 0) / w : 0;
}

/*Gender gap calculation*/
function genderGap(rows) {
  const f = weightedIncome(rows.filter(r => r.sex === 'F'));
  const m = weightedIncome(rows.filter(r => r.sex === 'M'));
  return m ? ((m - f) / m) * 100 : null;
}
function groupBy(rows, key) {
  return rows.reduce((groups, r) => { (groups[r[key]] ||= []).push(r); return groups; }, {});
}


/*Creating the charts*/
const INCOME = 'Median income'; 
const COLORS = { F: '#42e1e1', M: '#0d2593', base: '#61688e', highlight: '#4b349e',
                 palette: ['#309598', '#56B4E9', '#00329f', '#3667af', '#211cb4'] };
const charts = {};

function render(id, config) {
  if (typeof Chart === 'undefined') {
    throw new Error('Chart.js could not be loaded. Check your internet connection.');
  }
  const canvas = document.getElementById(id);
  if (!canvas) throw new Error(`Chart canvas "${id}" was not found`);
  if (charts[id]) charts[id].destroy();
  charts[id] = new Chart(canvas, config);
}

const baseOptions = (title, yTitle) => ({
  responsive: true,
  maintainAspectRatio: false,
  plugins: { title: { display: true, text: title, font: { size: 14 } } },
  scales: yTitle ? { y: { beginAtZero: true, title: { display: true, text: yTitle } } } : {}
});

/*Line Chart comaparing the median income of males and females in the chosen province*/
function drawLineChart(rows, sel) {
  const years = [...new Set(rows.map(r => r.year))].sort();
  const series = sex => years.map(y => weightedIncome(rows.filter(r => r.year === y && r.sex === sex)));
  const where = sel.province === 'All' ? 'all provinces' : provinceName(sel.province);
  render('lineChart', {
    type: 'line',
    data: { labels: years, datasets: [
      { label: 'Women', data: series('F'), borderColor: COLORS.F, backgroundColor: COLORS.F, tension: 0.3 },
      { label: 'Men', data: series('M'), borderColor: COLORS.M, backgroundColor: COLORS.M, tension: 0.3 }
    ] },
    options: baseOptions(`Median income over time, ${where}`, INCOME)
  });
}

/*Bar chart comparing provinces for the chosen year and gender*/
function drawBarChart(rows, province, sel) {
  const groups = groupBy(rows, 'province');
  const items = Object.entries(groups).map(([code, g]) => ({ code, value: weightedIncome(g) }))
                      .sort((a, b) => b.value - a.value);
  render('barChart', {
    type: 'bar',
    data: { labels: items.map(i => provinceName(i.code)), datasets: [{
      label: 'Median income', data: items.map(i => i.value),
      backgroundColor: items.map(i => (i.code === province ? COLORS.highlight : COLORS.base)) }] },
    options: { ...baseOptions(`Median income by province, ${sel.year}`, INCOME),
               plugins: { legend: { display: false }, title: { display: true, text: `Median income by province, ${sel.year}`, font: { size: 14 } } } }
  });
}

/*Doughnut chart*/
function drawDoughnutChart(rows) {
  const groups = groupBy(rows, 'age');
  const labels = Object.keys(groups).sort();
  render('doughnutChart', {
    type: 'doughnut',
    data: { labels, datasets: [{ data: labels.map(l => sumFte(groups[l])), backgroundColor: COLORS.palette }] },
    options: baseOptions('Share of FTE by age group')
  });
}

const $ = id => document.getElementById(id);
const fmt = n => n.toLocaleString('en-ZA', { maximumFractionDigits: 0 });

const unique = key => [...new Set(records.map(r => r[key]))].sort((a, b) => {
  if (typeof a === 'number' && typeof b === 'number') return b - a;
  return String(a).localeCompare(String(b));
});

function filterRecords(selection = {}) {
  return records.filter(r =>
    (!selection.province || selection.province === 'All' || r.province === selection.province) &&
    (!selection.year || selection.year === 'All' || r.year === Number(selection.year)) &&
    (!selection.sex || selection.sex === 'All' || r.sex === selection.sex)
  );
}

const currentSelection = () => ({
  province: $('provinceSelect').value,
  year: $('yearSelect').value,
  sex: $('sexSelect').value
});

function fillSelect(select, options) {
  select.replaceChildren();
  options.forEach(([value, text]) => {
    const option = document.createElement('option');
    option.value = String(value);
    option.textContent = String(text);
    select.appendChild(option);
  });
}

/*function that redraws the charts*/
function refreshDashboard() {
  const sel = currentSelection();
  const rows = filterRecords(sel);
 
  /* Summary indicators */
  $('indicatorFte').textContent = fmt(sumFte(rows));
  const gap = genderGap(filterRecords({ province: sel.province, year: sel.year }));
  $('indicatorGap').textContent = gap === null ? 'n/a' : `${gap.toFixed(1)}%`;
 
  /* Redraw the charts */
  drawLineChart(filterRecords({ province: sel.province }), sel);
  drawBarChart(filterRecords({ year: sel.year, sex: sel.sex }), sel.province, sel);
  drawDoughnutChart(rows);
}

/*function that sets up the dashboard*/
function setupDashboard() {
  const years = unique('year');
  const latestYear = years[0];

  fillSelect($('provinceSelect'), [['All', 'All provinces'],
    ...unique('province').map(p => [p, provinceName(p)])]);
  fillSelect($('yearSelect'), years.map(y => [y, y]));
  $('yearSelect').value = latestYear;

  ['provinceSelect', 'yearSelect', 'sexSelect'].forEach(id =>
    $(id).addEventListener('change', refreshDashboard));

  $('resetBtn').addEventListener('click', () => {
    $('provinceSelect').value = 'All';
    $('yearSelect').value = latestYear;
    $('sexSelect').value = 'All';
    refreshDashboard();
  });

  $('status').hidden = true;
  refreshDashboard();
}

function showError(err) {
  $('status').hidden = false;
  $('status').textContent = `Could not load the dashboard: ${err.message}. Run it from a local server (for example VS Code Live Server), not by double-clicking the file.`;
  console.error(err);
}

/* Load data before building controls and drawing the dashboard.*/
loadData().then(setupDashboard).catch(showError);