/**
 * @NApiVersion 2.1
 * @NScriptType Suitelet
 */
define(['N/ui/serverWidget','N/runtime','N/url'],
(serverWidget, runtime, url, analyticsLib) => {
    const ACTION_DATA = 'data';
    const ACTION_DETAIL = 'detail';

    function onRequest(context) {
        const req = context.request;
        const res = context.response;
        const action = req.parameters.action;

        try {
            if (req.method === 'GET' && action === ACTION_DATA) {
                returnJson(res, analyticsLib.getSalesSummaryData({
                    fromDate: req.parameters.from,
                    toDate: req.parameters.to,
                    customerId: req.parameters.customer,
                    itemId: req.parameters.item,
                    salesRepId: req.parameters.salesrep,
                    locationId: req.parameters.location,
                    topN: req.parameters.topn
                }));
                return;
            }

            if (req.method === 'GET' && action === ACTION_DETAIL) {
                returnJson(res, analyticsLib.getSalesDetailData({
                    fromDate: req.parameters.from,
                    toDate: req.parameters.to,
                    customerId: req.parameters.customer,
                    itemId: req.parameters.item,
                    salesRepId: req.parameters.salesrep,
                    locationId: req.parameters.location,
                    month: req.parameters.month
                }));
                return;
            }

            renderDashboard(context);
        } catch (e) {
            log.error('Sales Analytics Dashboard Error', e);
            if (action === ACTION_DATA || action === ACTION_DETAIL) {
                res.setHeader({ name: 'Content-Type', value: 'application/json; charset=utf-8' });
                res.write(JSON.stringify({ ok:false, message:e.message || String(e), stack:e.stack || null }));
                return;
            }
            res.write('Dashboard error: ' + escapeHtml(e.message || String(e)));
        }
    }

    function renderDashboard(context) {
        const form = serverWidget.createForm({ title: 'Sales Analytics Dashboard' });

        const html = form.addField({
            id: 'custpage_sales_analytics_html',
            label: 'Dashboard',
            type: serverWidget.FieldType.INLINEHTML
        });

        const baseUrl = url.resolveScript({
            scriptId: runtime.getCurrentScript().id,
            deploymentId: runtime.getCurrentScript().deploymentId,
            params: {}
        });

        html.defaultValue = buildHtml(baseUrl);
        context.response.writePage(form);
    }

    function buildHtml(baseUrl) {
        return `
<link rel="stylesheet" href="./sales_analytics.css">
<script>window.NSD_SALES_ANALYTICS={baseUrl:${JSON.stringify(baseUrl)}};</script>
<script src="./chart.min.js"></script>
<script src="sales_analytics_client.js"></script>

<div class="nsd-dashboard">
    <div class="nsd-header">
        <div>
            <h1>Sales Analytics</h1>
            <p>Rolling sales by item with filters, trend chart, drilldown, and CSV export.</p>
        </div>
        <button class="nsd-button primary" id="nsd-refresh-button" type="button">Refresh</button>
    </div>

    <div class="nsd-filters">
        <label><span>From Date</span><input type="date" id="nsd-from-date"></label>
        <label><span>To Date</span><input type="date" id="nsd-to-date"></label>
        <label><span>Customer ID</span><input type="text" id="nsd-customer-id" placeholder="Optional internal ID"></label>
        <label><span>Item ID</span><input type="text" id="nsd-item-id" placeholder="Optional internal ID"></label>
        <label><span>Sales Rep ID</span><input type="text" id="nsd-salesrep-id" placeholder="Optional internal ID"></label>
        <label><span>Location ID</span><input type="text" id="nsd-location-id" placeholder="Optional internal ID"></label>
        <label>
            <span>Top Rows</span>
            <select id="nsd-topn">
                <option value="50">50</option>
                <option value="100" selected>100</option>
                <option value="250">250</option>
                <option value="500">500</option>
            </select>
        </label>
    </div>

    <div class="nsd-kpis">
        <div class="nsd-kpi-card"><span>Total Sales</span><strong id="nsd-total-sales">-</strong></div>
        <div class="nsd-kpi-card"><span>Total Quantity</span><strong id="nsd-total-qty">-</strong></div>
        <div class="nsd-kpi-card"><span>Rows</span><strong id="nsd-total-rows">-</strong></div>
        <div class="nsd-kpi-card"><span>Period</span><strong id="nsd-period-label">-</strong></div>
    </div>

    <div class="nsd-panel">
        <div class="nsd-panel-title"><h2>Monthly Sales Trend</h2></div>
        <canvas id="nsd-sales-chart" height="90"></canvas>
    </div>

    <div class="nsd-panel">
        <div class="nsd-panel-title">
            <h2>Sales by Item</h2>
            <button class="nsd-button" id="nsd-export-button" type="button">Export CSV</button>
        </div>
        <div id="nsd-loading" class="nsd-loading" style="display:none;">Loading...</div>
        <div id="nsd-error" class="nsd-error" style="display:none;"></div>
        <div class="nsd-table-wrap">
            <table class="nsd-table">
                <thead id="nsd-result-head"></thead>
                <tbody id="nsd-result-body"></tbody>
            </table>
        </div>
    </div>

    <div class="nsd-modal-backdrop" id="nsd-detail-modal" style="display:none;">
        <div class="nsd-modal">
            <div class="nsd-modal-header">
                <h2 id="nsd-detail-title">Detail</h2>
                <button class="nsd-button" id="nsd-detail-close" type="button">Close</button>
            </div>
            <div id="nsd-detail-loading" class="nsd-loading" style="display:none;">Loading detail...</div>
            <div class="nsd-table-wrap detail">
                <table class="nsd-table">
                    <thead id="nsd-detail-head"></thead>
                    <tbody id="nsd-detail-body"></tbody>
                </table>
            </div>
        </div>
    </div>
</div>`;
    }

    function returnJson(response, payload) {
        response.setHeader({ name: 'Content-Type', value: 'application/json; charset=utf-8' });
        response.write(JSON.stringify(Object.assign({ ok:true }, payload)));
    }

    function escapeHtml(value) {
        return String(value || '').replace(/&/g,'&amp;').replace(/</g,'&lt;')
            .replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#039;');
    }

    return { onRequest };
});
