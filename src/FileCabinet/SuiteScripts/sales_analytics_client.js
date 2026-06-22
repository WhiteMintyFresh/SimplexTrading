(function () {
    'use strict';

    var state = { lastData:null, chart:null };

    document.addEventListener('DOMContentLoaded', function () {
        setDefaultDates();
        byId('nsd-refresh-button').addEventListener('click', loadDashboard);
        byId('nsd-export-button').addEventListener('click', exportCsv);
        byId('nsd-detail-close').addEventListener('click', closeDetailModal);
        loadDashboard();
    });

    function setDefaultDates() {
        var today = new Date();
        var from = new Date(today.getFullYear(), today.getMonth() - 11, 1);
        byId('nsd-from-date').value = toIsoDate(from);
        byId('nsd-to-date').value = toIsoDate(today);
    }

    async function loadDashboard() {
        showLoading(true);
        showError('');
        try {
            var data = await getJson(buildUrl('data'));
            if (!data.ok) throw new Error(data.message || 'Unable to load dashboard data.');
            state.lastData = data;
            renderSummary(data);
            renderChart(data);
            renderTable(data);
        } catch (e) {
            showError(e.message || String(e));
        } finally {
            showLoading(false);
        }
    }

    async function openDetail(itemId, month) {
        byId('nsd-detail-modal').style.display = 'block';
        byId('nsd-detail-loading').style.display = 'block';
        byId('nsd-detail-title').innerText = 'Detail - Item ' + itemId + ' - ' + month;
        byId('nsd-detail-head').innerHTML = '';
        byId('nsd-detail-body').innerHTML = '';

        try {
            var data = await getJson(buildUrl('detail', { item:itemId, month:month }));
            if (!data.ok) throw new Error(data.message || 'Unable to load detail data.');
            renderDetailTable(data.rows || []);
        } catch (e) {
            byId('nsd-detail-body').innerHTML = '<tr><td colspan="10">' + escapeHtml(e.message || String(e)) + '</td></tr>';
        } finally {
            byId('nsd-detail-loading').style.display = 'none';
        }
    }

    function closeDetailModal() { byId('nsd-detail-modal').style.display = 'none'; }

    function buildUrl(action, extra) {
        var url = new URL(window.NSD_SALES_ANALYTICS.baseUrl, window.location.origin);
        url.searchParams.set('action', action);
        url.searchParams.set('from', byId('nsd-from-date').value);
        url.searchParams.set('to', byId('nsd-to-date').value);
        url.searchParams.set('customer', byId('nsd-customer-id').value.trim());
        url.searchParams.set('item', byId('nsd-item-id').value.trim());
        url.searchParams.set('salesrep', byId('nsd-salesrep-id').value.trim());
        url.searchParams.set('location', byId('nsd-location-id').value.trim());
        url.searchParams.set('topn', byId('nsd-topn').value);
        if (extra) Object.keys(extra).forEach(function (key) { url.searchParams.set(key, extra[key]); });
        return url.toString();
    }

    async function getJson(url) {
        var response = await fetch(url, { method:'GET', credentials:'same-origin' });
        if (!response.ok) throw new Error('HTTP ' + response.status + ': ' + response.statusText);
        return response.json();
    }

    function renderSummary(data) {
        byId('nsd-total-sales').innerText = formatMoney(data.summary.totalSales);
        byId('nsd-total-qty').innerText = formatNumber(data.summary.totalQty);
        byId('nsd-total-rows').innerText = formatNumber((data.rows || []).length);
        byId('nsd-period-label').innerText = data.from + ' to ' + data.to;
    }

    function renderChart(data) {
        var canvas = byId('nsd-sales-chart');

        if (!window.Chart) {
            canvas.outerHTML = '<div class="nsd-error">Chart.js is not loaded. Replace chart.min.js with the real Chart.js file.</div>';
            return;
        }

        if (state.chart) state.chart.destroy();

        state.chart = new window.Chart(canvas, {
            type: 'bar',
            data: { labels:data.months, datasets:[{ label:'Sales', data:data.monthTotals }] },
            options: {
                responsive:true,
                plugins:{ legend:{ display:true } },
                scales:{ y:{ ticks:{ callback:function(value){ return formatShortMoney(value); } } } }
            }
        });
    }

    function renderTable(data) {
        var head = byId('nsd-result-head');
        var body = byId('nsd-result-body');
        var months = data.months || [];

        var header = '<tr><th>Item</th><th>Description</th><th>Type</th>';
        months.forEach(function (month) { header += '<th>' + escapeHtml(month) + '</th>'; });
        header += '<th>Total</th><th>Qty</th></tr>';
        head.innerHTML = header;

        var html = '';
        (data.rows || []).forEach(function (row) {
            html += '<tr><td>' + escapeHtml(row.itemname) + '</td><td>' + escapeHtml(row.description) + '</td><td>' + escapeHtml(row.itemtype) + '</td>';
            months.forEach(function (month) {
                var amount = Number((row.months || {})[month] || 0);
                var attrs = amount !== 0 ? ' class="nsd-number nsd-clickable" data-item="' + escapeAttr(row.itemid) + '" data-month="' + escapeAttr(month) + '"' : ' class="nsd-number"';
                html += '<td' + attrs + '>' + formatMoney(amount) + '</td>';
            });
            html += '<td class="nsd-number nsd-total">' + formatMoney(row.totalamount) + '</td>';
            html += '<td class="nsd-number">' + formatNumber(row.totalqty) + '</td></tr>';
        });

        if (!html) html = '<tr><td colspan="' + (months.length + 5) + '">No results found.</td></tr>';
        body.innerHTML = html;

        Array.prototype.forEach.call(document.querySelectorAll('.nsd-clickable'), function (cell) {
            cell.addEventListener('click', function () {
                openDetail(cell.getAttribute('data-item'), cell.getAttribute('data-month'));
            });
        });
    }

    function renderDetailTable(rows) {
        byId('nsd-detail-head').innerHTML = '<tr><th>Date</th><th>Transaction</th><th>Type</th><th>Customer</th><th>Sales Rep</th><th>Location</th><th>Item</th><th>Description</th><th>Qty</th><th>Amount</th></tr>';

        if (!rows.length) {
            byId('nsd-detail-body').innerHTML = '<tr><td colspan="10">No detail rows found.</td></tr>';
            return;
        }

        byId('nsd-detail-body').innerHTML = rows.map(function (row) {
            return '<tr>' +
                '<td>' + escapeHtml(row.trandate) + '</td>' +
                '<td>' + escapeHtml(row.tranid) + '</td>' +
                '<td>' + escapeHtml(row.transactiontype) + '</td>' +
                '<td>' + escapeHtml(row.customer) + '</td>' +
                '<td>' + escapeHtml(row.salesrep) + '</td>' +
                '<td>' + escapeHtml(row.location) + '</td>' +
                '<td>' + escapeHtml(row.itemname) + '</td>' +
                '<td>' + escapeHtml(row.description) + '</td>' +
                '<td class="nsd-number">' + formatNumber(row.quantity) + '</td>' +
                '<td class="nsd-number">' + formatMoney(row.amount) + '</td>' +
                '</tr>';
        }).join('');
    }

    function exportCsv() {
        if (!state.lastData) return;
        var data = state.lastData;
        var months = data.months || [];
        var lines = [['Item','Description','Type'].concat(months).concat(['Total','Qty'])];

        (data.rows || []).forEach(function (row) {
            var line = [row.itemname || '', row.description || '', row.itemtype || ''];
            months.forEach(function (month) { line.push((row.months || {})[month] || 0); });
            line.push(row.totalamount || 0);
            line.push(row.totalqty || 0);
            lines.push(line);
        });

        var csv = lines.map(function (line) { return line.map(csvCell).join(','); }).join('\n');
        var blob = new Blob([csv], { type:'text/csv;charset=utf-8;' });
        var link = document.createElement('a');
        link.href = URL.createObjectURL(blob);
        link.download = 'sales_analytics_' + byId('nsd-from-date').value + '_to_' + byId('nsd-to-date').value + '.csv';
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
    }

    function csvCell(value) {
        var text = String(value == null ? '' : value);
        return /[",\n]/.test(text) ? '"' + text.replace(/"/g, '""') + '"' : text;
    }

    function showLoading(flag) { byId('nsd-loading').style.display = flag ? 'block' : 'none'; }

    function showError(message) {
        var el = byId('nsd-error');
        el.style.display = message ? 'block' : 'none';
        el.innerText = message || '';
    }

    function formatMoney(value) {
        return Number(value || 0).toLocaleString(undefined, { minimumFractionDigits:2, maximumFractionDigits:2 });
    }

    function formatShortMoney(value) {
        var n = Number(value || 0);
        if (Math.abs(n) >= 1000000) return (n / 1000000).toFixed(1) + 'M';
        if (Math.abs(n) >= 1000) return (n / 1000).toFixed(0) + 'K';
        return String(n);
    }

    function formatNumber(value) {
        return Number(value || 0).toLocaleString(undefined, { maximumFractionDigits:4 });
    }

    function toIsoDate(date) {
        return [date.getFullYear(), String(date.getMonth()+1).padStart(2,'0'), String(date.getDate()).padStart(2,'0')].join('-');
    }

    function escapeHtml(value) {
        return String(value == null ? '' : value).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#039;');
    }

    function escapeAttr(value) { return escapeHtml(value).replace(/`/g,'&#096;'); }
    function byId(id) { return document.getElementById(id); }
})();
