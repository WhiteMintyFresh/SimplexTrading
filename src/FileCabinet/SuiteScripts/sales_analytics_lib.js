/**
 * @NApiVersion 2.1
 */
define(['N/query'], (query) => {
    const DEFAULT_TOP_N = 100;
    const MAX_TOP_N = 1000;

    function getSalesSummaryData(options) {
        const normalized = normalizeOptions(options || {});
        const months = buildMonthList(normalized.fromDate, normalized.toDate);
        const resultRows = runSummaryQuery(normalized);

        const rowMap = {};
        const monthTotals = {};
        let totalSales = 0;
        let totalQty = 0;

        months.forEach(month => monthTotals[month] = 0);

        resultRows.forEach(row => {
            const itemId = String(row.itemid || 'noitem');
            const month = row.salesmonth;
            const amount = Number(row.amount || 0);
            const quantity = Number(row.quantity || 0);

            if (!rowMap[itemId]) {
                rowMap[itemId] = {
                    itemid: row.itemid,
                    itemname: row.itemname || '',
                    description: row.description || '',
                    itemtype: row.itemtype || '',
                    months: {},
                    totalamount: 0,
                    totalqty: 0
                };
                months.forEach(m => rowMap[itemId].months[m] = 0);
            }

            if (Object.prototype.hasOwnProperty.call(rowMap[itemId].months, month)) {
                rowMap[itemId].months[month] += amount;
                monthTotals[month] += amount;
            }

            rowMap[itemId].totalamount += amount;
            rowMap[itemId].totalqty += quantity;
            totalSales += amount;
            totalQty += quantity;
        });

        const rows = Object.keys(rowMap)
            .map(key => rowMap[key])
            .sort((a,b) => Math.abs(b.totalamount) - Math.abs(a.totalamount))
            .slice(0, normalized.topN)
            .map(row => {
                const cleanMonths = {};
                months.forEach(month => cleanMonths[month] = roundCurrency(row.months[month] || 0));
                row.months = cleanMonths;
                row.totalamount = roundCurrency(row.totalamount);
                row.totalqty = roundQuantity(row.totalqty);
                return row;
            });

        return {
            from: normalized.fromDate,
            to: normalized.toDate,
            months,
            monthTotals: months.map(month => roundCurrency(monthTotals[month] || 0)),
            summary: {
                totalSales: roundCurrency(totalSales),
                totalQty: roundQuantity(totalQty)
            },
            rows
        };
    }

    function getSalesDetailData(options) {
        const normalized = normalizeOptions(options || {});
        const params = [normalized.fromDate, normalized.toDate];
        const filters = buildBaseFilters();
        appendOptionalFilters(filters, params, normalized);

        if (normalized.month) {
            filters.push(`TO_CHAR(t.trandate, 'YYYY-MM') = ?`);
            params.push(normalized.month);
        }

        const sql = `
            SELECT
                t.id AS transactionid,
                t.tranid AS tranid,
                t.trandate AS trandate,
                t.type AS transactiontype,
                BUILTIN.DF(t.entity) AS customer,
                BUILTIN.DF(t.employee) AS salesrep,
                BUILTIN.DF(tl.location) AS location,
                i.id AS itemid,
                i.itemid AS itemname,
                BUILTIN.DF(i.displayname) AS description,
                CASE WHEN t.type = 'CustCred' THEN NVL(tl.quantity,0) * -1 ELSE NVL(tl.quantity,0) END AS quantity,
                CASE WHEN t.type = 'CustCred' THEN NVL(tl.netamount,0) * -1 ELSE NVL(tl.netamount,0) END AS amount
            FROM transaction t
            INNER JOIN transactionline tl ON tl.transaction = t.id
            LEFT JOIN item i ON i.id = tl.item
            WHERE ${filters.join(' AND ')}
            ORDER BY t.trandate DESC, t.tranid DESC
        `;

        const rows = query.runSuiteQL({ query: sql, params }).asMappedResults();

        return {
            rows: rows.map(row => ({
                transactionid: row.transactionid,
                tranid: row.tranid,
                trandate: row.trandate,
                transactiontype: row.transactiontype,
                customer: row.customer || '',
                salesrep: row.salesrep || '',
                location: row.location || '',
                itemid: row.itemid,
                itemname: row.itemname || '',
                description: row.description || '',
                quantity: roundQuantity(row.quantity || 0),
                amount: roundCurrency(row.amount || 0)
            }))
        };
    }

    function runSummaryQuery(normalized) {
        const params = [normalized.fromDate, normalized.toDate];
        const filters = buildBaseFilters();
        appendOptionalFilters(filters, params, normalized);

        const sql = `
            SELECT
                i.id AS itemid,
                i.itemid AS itemname,
                BUILTIN.DF(i.displayname) AS description,
                BUILTIN.DF(i.itemtype) AS itemtype,
                TO_CHAR(t.trandate, 'YYYY-MM') AS salesmonth,
                SUM(CASE WHEN t.type = 'CustCred' THEN NVL(tl.netamount,0) * -1 ELSE NVL(tl.netamount,0) END) AS amount,
                SUM(CASE WHEN t.type = 'CustCred' THEN NVL(tl.quantity,0) * -1 ELSE NVL(tl.quantity,0) END) AS quantity
            FROM transaction t
            INNER JOIN transactionline tl ON tl.transaction = t.id
            LEFT JOIN item i ON i.id = tl.item
            WHERE ${filters.join(' AND ')}
            GROUP BY
                i.id,
                i.itemid,
                BUILTIN.DF(i.displayname),
                BUILTIN.DF(i.itemtype),
                TO_CHAR(t.trandate, 'YYYY-MM')
            ORDER BY i.itemid, TO_CHAR(t.trandate, 'YYYY-MM')
        `;

        return query.runSuiteQL({ query: sql, params }).asMappedResults();
    }

    function buildBaseFilters() {
        return [
            `t.type IN ('CustInvc', 'CashSale', 'CustCred')`,
            `t.trandate BETWEEN TO_DATE(?, 'YYYY-MM-DD') AND TO_DATE(?, 'YYYY-MM-DD')`,
            `tl.mainline = 'F'`,
            `tl.taxline = 'F'`,
            `tl.iscogs = 'F'`,
            `tl.item IS NOT NULL`
        ];
    }

    function appendOptionalFilters(filters, params, normalized) {
        if (normalized.customerId) { filters.push(`t.entity = ?`); params.push(normalized.customerId); }
        if (normalized.itemId) { filters.push(`tl.item = ?`); params.push(normalized.itemId); }
        if (normalized.salesRepId) { filters.push(`t.employee = ?`); params.push(normalized.salesRepId); }
        if (normalized.locationId) { filters.push(`tl.location = ?`); params.push(normalized.locationId); }
    }

    function normalizeOptions(options) {
        const today = new Date();
        const fromDefault = new Date(today.getFullYear(), today.getMonth() - 11, 1);

        return {
            fromDate: sanitizeDate(options.fromDate) || toIsoDate(fromDefault),
            toDate: sanitizeDate(options.toDate) || toIsoDate(today),
            customerId: sanitizeInternalId(options.customerId),
            itemId: sanitizeInternalId(options.itemId),
            salesRepId: sanitizeInternalId(options.salesRepId),
            locationId: sanitizeInternalId(options.locationId),
            month: sanitizeMonth(options.month),
            topN: sanitizeTopN(options.topN)
        };
    }

    function sanitizeDate(value) {
        const text = String(value || '').trim();
        return /^\d{4}-\d{2}-\d{2}$/.test(text) ? text : '';
    }

    function sanitizeMonth(value) {
        const text = String(value || '').trim();
        return /^\d{4}-\d{2}$/.test(text) ? text : '';
    }

    function sanitizeInternalId(value) {
        const text = String(value || '').trim();
        if (!text) return '';
        if (!/^\d+$/.test(text)) throw new Error('Internal ID filters must be numeric.');
        return text;
    }

    function sanitizeTopN(value) {
        const parsed = parseInt(value || DEFAULT_TOP_N, 10);
        if (Number.isNaN(parsed) || parsed <= 0) return DEFAULT_TOP_N;
        return Math.min(parsed, MAX_TOP_N);
    }

    function buildMonthList(fromDate, toDate) {
        const months = [];
        const from = parseIsoDate(fromDate);
        const to = parseIsoDate(toDate);
        const cursor = new Date(from.getFullYear(), from.getMonth(), 1);
        const end = new Date(to.getFullYear(), to.getMonth(), 1);

        while (cursor <= end) {
            months.push(cursor.getFullYear() + '-' + String(cursor.getMonth()+1).padStart(2,'0'));
            cursor.setMonth(cursor.getMonth()+1);
        }
        return months;
    }

    function parseIsoDate(value) {
        const p = String(value).split('-').map(Number);
        return new Date(p[0], p[1]-1, p[2]);
    }

    function toIsoDate(dateObj) {
        return [
            dateObj.getFullYear(),
            String(dateObj.getMonth()+1).padStart(2,'0'),
            String(dateObj.getDate()).padStart(2,'0')
        ].join('-');
    }

    function roundCurrency(value) { return Math.round(Number(value || 0) * 100) / 100; }
    function roundQuantity(value) { return Math.round(Number(value || 0) * 10000) / 10000; }

    return { getSalesSummaryData, getSalesDetailData };
});
