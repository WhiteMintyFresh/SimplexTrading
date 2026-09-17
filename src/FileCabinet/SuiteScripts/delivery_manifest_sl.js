/**
 * Delivery Manifest - Trip Based
 * @NApiVersion 2.1
 * @NScriptType Suitelet
 */
define(['N/ui/serverWidget','N/search','N/format','N/log'], (serverWidget, search, format, log) => {
    'use strict';

    const SAVED_SEARCH_ID = 'customsearch1453';
    const MAX_RESULTS = 10000;

    const FIELDS = {
        DATE_SCOPE: 'custpage_date_scope',
        DATE_FROM: 'custpage_date_from',
        DATE_TO: 'custpage_date_to',
        TRIP: 'custpage_trip',
        TRUCK_1: 'custpage_truck_1',
        TRUCK_2: 'custpage_truck_2'
    };

    const PAYMENT_WORDS = ['cash', 'cheque', 'check'];

    /* Delivery Address must come from the transaction Ship To address. */
    const COLUMN_NAMES = {
        createdFrom: ['Created From','createdfrom'],
        transaction: ['Transaction Name','Document Number','Tran ID','tranid'],
        company: ['Customer : Name','Customer : Company Name','Company Name','Customer','Entity','Name','entity'],
        address: ['Shipping Address','Ship Address','Ship To','shipaddress'],
        total: ['Amount (Transaction Total)','Transaction Total','Total','total','amount'],
        payment: [
            'Payment Type','Payment Method','Payment Method (C)',
            'Payment Method (C) (Custom Body)','Order Type',
            'Simplex Payment Methods','Simplex Payment Methods (Custom Body)',
            'custbody_simplex_payment_methods','paymentmethod','ordertype'
        ],
        physical: ['Physical Payment','Physical Collection','Cash/Cheque Amount','Cash Cheque Amount']
    };

    const onRequest = (context) => {
        try {
            if (context.request.method === 'POST') {
                generatePdf(context);
            } else {
                showForm(context);
            }
        } catch (e) {
            log.error({ title: 'Delivery Manifest Error', details: e });
            context.response.write({
                output:
                    '<html><body style="font-family:Arial;padding:24px">' +
                    '<h2>Delivery Manifest Error</h2><pre>' +
                    escapeXml((e.name || 'ERROR') + ': ' + e.message) +
                    '</pre></body></html>'
            });
        }
    };

    const showForm = (context) => {
        const form = serverWidget.createForm({ title: 'Delivery Manifest' });

        const info = form.addField({
            id: 'custpage_info',
            type: serverWidget.FieldType.INLINEHTML,
            label: ' '
        });
        info.defaultValue =
            '<div style="padding:12px;margin-bottom:14px;background:#f4f7f9;border-left:4px solid #2b6478">' +
            'The manifest defaults to invoices created today. Use <b>Trip #</b> and/or <b>Truck #</b> to narrow the manifest. ' +
            'Leave both blank to include all trips and trucks for the selected date scope.</div>';

        const scope = form.addField({
            id: FIELDS.DATE_SCOPE,
            type: serverWidget.FieldType.SELECT,
            label: 'Date Scope'
        });
        scope.addSelectOption({ value: 'TODAY', text: 'Today' });
        scope.addSelectOption({ value: 'ALL', text: 'All Dates' });
        scope.addSelectOption({ value: 'RANGE', text: 'Custom Date Range' });
        scope.defaultValue = 'TODAY';

        form.addField({ id: FIELDS.DATE_FROM, type: serverWidget.FieldType.DATE, label: 'Date From' });
        form.addField({ id: FIELDS.DATE_TO, type: serverWidget.FieldType.DATE, label: 'Date To' });

        const trip = form.addField({
            id: FIELDS.TRIP,
            type: serverWidget.FieldType.TEXT,
            label: 'Trip #'
        });
        trip.setHelpText({
            help: 'Enter the Trip # from the Sales Order / Item Fulfillment, e.g. 1. Leave blank for all trips.'
        });

        const truck1 = form.addField({
            id: FIELDS.TRUCK_1,
            type: serverWidget.FieldType.TEXT,
            label: 'Truck # 1'
        });
        truck1.setHelpText({
            help: 'Enter the first truck identifier, e.g. C394 or Pine.'
        });

        const truck2 = form.addField({
            id: FIELDS.TRUCK_2,
            type: serverWidget.FieldType.TEXT,
            label: 'Truck # 2'
        });
        truck2.setHelpText({
            help: 'Optional second truck/driver selection for the same manifest.'
        });

        form.addSubmitButton({ label: 'Generate PDF' });
        context.response.writePage(form);
    };

    const generatePdf = (context) => {
        const p = context.request.parameters;
        const dateScope = p[FIELDS.DATE_SCOPE] || 'TODAY';
        const dateFrom = p[FIELDS.DATE_FROM] || '';
        const dateTo = p[FIELDS.DATE_TO] || '';
        const tripFilter = trim(p[FIELDS.TRIP]);
        const truckFilter1 = trim(p[FIELDS.TRUCK_1]);
        const truckFilter2 = trim(p[FIELDS.TRUCK_2]);

        const s = search.load({ id: SAVED_SEARCH_ID });
        applyDateFilter(s, dateScope, dateFrom, dateTo);

        const cols = resolveColumns(s.columns || []);
        validateColumns(cols);

        const rows = loadRows(s, cols, tripFilter, truckFilter1, truckFilter2);
        rows.sort((a,b) =>
            compareTrip(a.trip,b.trip) ||
            compareText(a.truck,b.truck) ||
            compareText(a.driver,b.driver) ||
            compareText(a.company,b.company)
        );

        context.response.renderPdf({
            xmlString: buildPdfXml({
                rows,
                dateLabel: getDateLabel(dateScope,dateFrom,dateTo),
                tripFilter,
                truckFilter1,
                truckFilter2,
                generatedAt: format.format({ value: new Date(), type: format.Type.DATETIME })
            })
        });
    };

    const applyDateFilter = (s, scope, from, to) => {
        const filters = (s.filters || []).filter(f => String(f.name || '').toLowerCase() !== 'datecreated');

        if (scope === 'TODAY') {
            filters.push(search.createFilter({
                name: 'datecreated',
                operator: search.Operator.WITHIN,
                values: ['today']
            }));
        } else if (scope === 'RANGE') {
            if (!from && !to) throw new Error('Enter Date From, Date To, or both.');
            if (from && to) {
                filters.push(search.createFilter({
                    name: 'datecreated',
                    operator: search.Operator.WITHIN,
                    values: [from,to]
                }));
            } else if (from) {
                filters.push(search.createFilter({
                    name: 'datecreated',
                    operator: search.Operator.ONORAFTER,
                    values: from
                }));
            } else {
                filters.push(search.createFilter({
                    name: 'datecreated',
                    operator: search.Operator.ONORBEFORE,
                    values: to
                }));
            }
        }
        s.filters = filters;
    };

    const resolveColumns = (cols) => ({
        createdFrom: findColumn(cols, COLUMN_NAMES.createdFrom),
        transaction: findColumn(cols, COLUMN_NAMES.transaction),
        company: findColumn(cols, COLUMN_NAMES.company),
        address: findColumn(cols, COLUMN_NAMES.address),
        total: findColumn(cols, COLUMN_NAMES.total),
        payment: findColumn(cols, COLUMN_NAMES.payment),
        physical: findColumn(cols, COLUMN_NAMES.physical)
    });

    const validateColumns = (c) => {
        const missing = [];
        if (!c.createdFrom) missing.push('Created From');
        if (!c.transaction) missing.push('Transaction Name');
        if (!c.company) missing.push('Customer : Name');
        if (!c.address) missing.push('Shipping Address');
        if (!c.physical && (!c.total || !c.payment)) {
            missing.push('Physical Payment, or Transaction Total plus Payment Method');
        }
        if (missing.length) {
            throw new Error(`Saved search ${SAVED_SEARCH_ID} is missing: ${missing.join(', ')}`);
        }
    };

    const loadRows = (s, cols, tripFilter, truckFilter1, truckFilter2) => {
        const invoiceRows = [];
        const salesOrderIds = [];
        const seenSalesOrders = {};

        const paged = s.runPaged({ pageSize: 1000 });

        if (paged.count > MAX_RESULTS) {
            throw new Error(`The search returned ${paged.count} rows. Narrow the date, Trip #, or Truck #.`);
        }

        paged.pageRanges.forEach(pr => {
            const page = paged.fetch({ index: pr.index });

            page.data.forEach(result => {
                const salesOrderId = String(getRawValue(result, cols.createdFrom) || '');

                invoiceRows.push({
                    salesOrderId,
                    transaction: getDisplayValue(result, cols.transaction),
                    company: getDisplayValue(result, cols.company),
                    address: normalizeAddress(getDisplayValue(result, cols.address)),
                    physicalPayment: getPhysicalPayment(result, cols)
                });

                if (salesOrderId && !seenSalesOrders[salesOrderId]) {
                    seenSalesOrders[salesOrderId] = true;
                    salesOrderIds.push(salesOrderId);
                }
            });
        });

        const fulfillmentMap = getFulfillmentMapForSalesOrders(salesOrderIds);
        const rows = [];

        invoiceRows.forEach(invoice => {
            const fulfillments = fulfillmentMap[invoice.salesOrderId] || [];
            let selected = null;

            if (tripFilter || truckFilter1 || truckFilter2) {
                selected = fulfillments.find(f => {
                    const tripOk =
                        !tripFilter ||
                        tripMatches(f.trip, tripFilter) ||
                        tripMatches(f.tripRaw, tripFilter);

                    const noTruckFilter = !truckFilter1 && !truckFilter2;

                    const truck1Ok =
                        truckFilter1 &&
                        (
                            truckMatches(f.truck, truckFilter1) ||
                            truckMatches(f.truckDriver, truckFilter1)
                        );

                    const truck2Ok =
                        truckFilter2 &&
                        (
                            truckMatches(f.truck, truckFilter2) ||
                            truckMatches(f.truckDriver, truckFilter2)
                        );

                    const truckOk = noTruckFilter || truck1Ok || truck2Ok;

                    return tripOk && truckOk;
                });

                if (!selected) return;
            } else if (fulfillments.length) {
                selected = fulfillments[0];
            }

            rows.push({
                trip: selected ? (selected.trip || selected.tripRaw || 'Unassigned') : 'Unassigned',
                truck: selected ? (selected.truck || 'Unassigned') : 'Unassigned',
                driver: selected ? (selected.driver || 'Unassigned') : 'Unassigned',
                truckDriver: selected ? (selected.truckDriver || 'Unassigned') : 'Unassigned',
                picker: selected ? (selected.picker || '') : '',
                transaction: invoice.transaction,
                company: invoice.company,
                address: invoice.address,
                physicalPayment: invoice.physicalPayment
            });
        });

        return rows;
    };

    const getFulfillmentMapForSalesOrders = (salesOrderIds) => {
        const map = {};
        if (!salesOrderIds.length) return map;

        const CHUNK_SIZE = 900;

        for (let start = 0; start < salesOrderIds.length; start += CHUNK_SIZE) {
            const chunk = salesOrderIds.slice(start, start + CHUNK_SIZE);

            const fulfillmentSearch = search.create({
                type: search.Type.ITEM_FULFILLMENT,
                filters: [
                    ['createdfrom','anyof',chunk],
                    'AND',
                    ['mainline','is','T']
                ],
                columns: [
                    search.createColumn({ name:'createdfrom' }),
                    search.createColumn({ name:'custbody_truck' }),
                    search.createColumn({ name:'custbody_simplex_picked_by' }),
                    search.createColumn({ name:'custbody_simplex_trip_number' }),
                    search.createColumn({ name:'trandate', sort:search.Sort.DESC }),
                    search.createColumn({ name:'internalid', sort:search.Sort.DESC })
                ]
            });

            const paged = fulfillmentSearch.runPaged({ pageSize: 1000 });

            paged.pageRanges.forEach(pr => {
                const page = paged.fetch({ index: pr.index });

                page.data.forEach(r => {
                    const salesOrderId = String(r.getValue({ name:'createdfrom' }) || '');
                    if (!salesOrderId) return;

                    const combined = getResultTextOrValue(r,'custbody_truck');
                    const parsed = parseTruckDriver(combined);

                    if (!map[salesOrderId]) map[salesOrderId] = [];

                    map[salesOrderId].push({
                        trip: getResultTextOrValue(r,'custbody_simplex_trip_number'),
                        tripRaw: getResultValue(r,'custbody_simplex_trip_number'),
                        truck: parsed.truck,
                        driver: parsed.driver,
                        truckDriver: combined,
                        picker: getResultTextOrValue(r,'custbody_simplex_picked_by')
                    });
                });
            });
        }

        return map;
    };

    const parseTruckDriver = (combined) => {
        const value = trim(combined);
        if (!value) return { truck:'', driver:'' };

        const sep = ' - ';
        const i = value.indexOf(sep);

        /*
         * Some legacy/custom-list values contain only one value,
         * e.g. "Pine", "Dario", "Grafton", "Trevor".
         *
         * In those cases use the same value for both Truck and Driver
         * so the PDF does not show Driver: Unassigned.
         */
        if (i === -1) {
            return {
                truck: value,
                driver: value
            };
        }

        return {
            truck: trim(value.substring(0,i)),
            driver: trim(value.substring(i + sep.length))
        };
    };

    const getPhysicalPayment = (result, cols) => {
        if (cols.physical) return parseNumber(getRawValue(result, cols.physical));

        const paymentText = getDisplayValue(result, cols.payment).toLowerCase();
        const isPhysical = PAYMENT_WORDS.some(word => paymentText.includes(word));

        return isPhysical ? parseNumber(getRawValue(result, cols.total)) : 0;
    };

    const buildPdfXml = ({ rows, dateLabel, tripFilter, truckFilter1, truckFilter2, generatedAt }) => {
        const groups = groupRows(rows);
        const xml = [];

        xml.push('<?xml version="1.0" encoding="UTF-8"?>');
        xml.push('<!DOCTYPE pdf PUBLIC "-//big.faceless.org//report" "report-1.1.dtd">');
        xml.push('<pdf><head>');
        xml.push('<macrolist><macro id="footer"><table width="100%" style="font-size:7pt;color:#666"><tr>');
        xml.push(`<td>Generated ${escapeXml(generatedAt)}</td>`);
        xml.push('<td align="right">Page <pagenumber/> of <totalpages/></td>');
        xml.push('</tr></table></macro></macrolist>');
        xml.push('<style type="text/css">');
        xml.push('body{font-family:Helvetica,Arial,sans-serif;font-size:8.5pt;color:#222}');
        xml.push('table{border-collapse:collapse}.title{font-size:20pt;font-weight:bold;color:#173d4f}');
        xml.push('.meta{font-size:8pt;color:#555}.trip{background:#173d4f;color:#fff;font-size:12pt;font-weight:bold}');
        xml.push('.group{background:#e9f0f3;border:0.5pt solid #9fb3bd}.head{background:#2b6478;color:#fff;font-weight:bold}');
        xml.push('.cell{border-bottom:0.4pt solid #c9d2d6;padding:5pt 4pt;vertical-align:top}');
        xml.push('.total{font-weight:bold;background:#f1f4f5;padding:6pt 4pt}');
        xml.push('</style></head>');
        xml.push('<body size="A4-landscape" padding="18pt 22pt 25pt 22pt" footer="footer" footer-height="17pt">');

        xml.push('<table width="100%" style="margin-bottom:10pt"><tr>');
        xml.push('<td class="title">Delivery Manifest</td>');
        xml.push(`<td align="right" class="meta">Date Scope: ${escapeXml(dateLabel)}</td></tr><tr>`);
        xml.push(`<td class="meta">Invoices: ${rows.length}</td>`);
        const activeFilters = [];
        if (tripFilter) activeFilters.push('Trip #: ' + escapeXml(tripFilter));
        if (truckFilter1) activeFilters.push('Truck #1: ' + escapeXml(truckFilter1));
        if (truckFilter2) activeFilters.push('Truck #2: ' + escapeXml(truckFilter2));

        xml.push(
            `<td align="right" class="meta">${
                activeFilters.length ? activeFilters.join(' | ') : 'All Trips / All Trucks'
            }</td>`
        );
        xml.push('</tr></table>');

        if (!rows.length) {
            xml.push('<table width="100%"><tr><td class="cell" align="center" style="padding:25pt">');
            xml.push('No transactions matched the selected date, Trip #, and Truck # filters.</td></tr></table>');
        }

        groups.forEach((g, idx) => {
            if (idx > 0) xml.push('<pbr/>');

            xml.push('<table width="100%" style="margin-bottom:6pt"><tr class="trip">');
            xml.push(`<td style="padding:7pt">Trip # ${escapeXml(g.trip)}</td>`);
            xml.push(`<td align="right" style="padding:7pt">Stops: ${g.rows.length}</td></tr></table>`);

            xml.push('<table width="100%" class="group" style="margin-bottom:6pt"><tr>');
            xml.push(`<td style="padding:6pt"><b>Truck:</b> ${escapeXml(g.truck)}</td>`);
            xml.push(`<td style="padding:6pt"><b>Driver:</b> ${escapeXml(g.driver)}</td>`);
            xml.push('</tr></table>');

            xml.push('<table width="100%"><thead><tr class="head">');
            xml.push('<td width="4%" style="padding:5pt 4pt">#</td>');
            xml.push('<td width="13%" style="padding:5pt 4pt">Invoice</td>');
            xml.push('<td width="25%" style="padding:5pt 4pt">Customer</td>');
            xml.push('<td width="43%" style="padding:5pt 4pt">Delivery Address</td>');
            xml.push('<td width="15%" align="right" style="padding:5pt 4pt">Cash/Cheque</td>');
            xml.push('</tr></thead><tbody>');

            g.rows.forEach((r,i) => {
                xml.push('<tr>');
                xml.push(`<td class="cell">${i+1}</td>`);
                xml.push(`<td class="cell">${escapeXml(r.transaction)}</td>`);
                xml.push(`<td class="cell">${escapeXml(r.company)}</td>`);
                xml.push(`<td class="cell">${escapeXml(r.address)}</td>`);
                xml.push(`<td class="cell" align="right">${r.physicalPayment ? escapeXml(formatMoney(r.physicalPayment)) : ''}</td>`);
                xml.push('</tr>');
            });

            xml.push('<tr><td colspan="4" class="total" align="right">Trip Physical Collection Total</td>');
            xml.push(`<td class="total" align="right">${escapeXml(formatMoney(g.total))}</td></tr>`);
            xml.push('</tbody></table>');
        });

        xml.push('</body></pdf>');
        return xml.join('');
    };

    const groupRows = (rows) => {
        const map = {};
        const groups = [];

        rows.forEach(r => {
            const key = `${r.trip}\u0001${r.truckDriver}`;
            if (!map[key]) {
                map[key] = {
                    trip:r.trip,
                    truck:r.truck,
                    driver:r.driver,
                    rows:[],
                    total:0
                };
                groups.push(map[key]);
            }
            map[key].rows.push(r);
            map[key].total += r.physicalPayment;
        });

        return groups;
    };

    const findColumn = (cols, names) => {
        const expected = names.map(normalizeKey);

        for (const col of cols) {
            const candidates = [col.label,col.name,col.join ? `${col.join}.${col.name}` : '']
                .filter(Boolean)
                .map(normalizeKey);

            if (candidates.some(c => expected.includes(c))) return col;
        }

        return null;
    };

    const getDisplayValue = (result, col) => {
        if (!col) return '';
        try {
            const t = result.getText(col);
            if (t !== null && t !== undefined && String(t) !== '') return String(t);
        } catch (e) {}
        const v = result.getValue(col);
        return v === null || v === undefined ? '' : String(v);
    };

    const getRawValue = (result, col) => {
        if (!col) return '';
        const v = result.getValue(col);
        return v === null || v === undefined ? '' : v;
    };

    const getLookupValue = (value) => {
        if (Array.isArray(value)) return value.length && value[0] && value[0].value ? String(value[0].value) : '';
        if (value && typeof value === 'object' && value.value) return String(value.value);
        return value ? String(value) : '';
    };

    const getResultTextOrValue = (result, name) => {
        try {
            const t = result.getText({ name });
            if (t !== null && t !== undefined && String(t) !== '') return String(t);
        } catch (e) {}
        return getResultValue(result,name);
    };

    const getResultValue = (result, name) => {
        const v = result.getValue({ name });
        return v === null || v === undefined ? '' : String(v);
    };

    const normalizeTrip = (value) =>
        String(value || '').trim().toLowerCase()
            .replace(/^trip\s*#?\s*/i,'')
            .replace(/^#\s*/,'');

    const tripMatches = (a,b) => {
        const x = normalizeTrip(a);
        const y = normalizeTrip(b);
        return x !== '' && y !== '' && x === y;
    };

    const normalizeTruck = (value) =>
        String(value || '')
            .trim()
            .toLowerCase()
            .replace(/\s+/g,'');

    const truckMatches = (truckValue, filterValue) => {
        const truck = normalizeTruck(truckValue);
        const filter = normalizeTruck(filterValue);

        if (!truck || !filter) return false;

        return (
            truck === filter ||
            truck.startsWith(filter + '-')
        );
    };

    const compareTrip = (a,b) => {
        const x = parseFloat(normalizeTrip(a));
        const y = parseFloat(normalizeTrip(b));
        if (!Number.isNaN(x) && !Number.isNaN(y)) return x-y;
        return compareText(a,b);
    };

    const compareText = (a,b) => {
        const x = String(a || '').toLowerCase();
        const y = String(b || '').toLowerCase();
        return x < y ? -1 : x > y ? 1 : 0;
    };

    const parseNumber = (value) => {
        if (typeof value === 'number') return value;
        const n = parseFloat(String(value || '').replace(/[^0-9.-]/g,''));
        return Number.isNaN(n) ? 0 : n;
    };

    const formatMoney = (value) => {
        const fixed = Number(value || 0).toFixed(2).split('.');
        let integer = fixed[0];
        let sign = '';
        if (integer.startsWith('-')) {
            sign = '-';
            integer = integer.substring(1);
        }
        integer = integer.replace(/\B(?=(\d{3})+(?!\d))/g,',');
        return `${sign}${integer}.${fixed[1]}`;
    };

    const normalizeAddress = (value) =>
        String(value || '')
            .replace(/\r\n/g,', ')
            .replace(/[\r\n]+/g,', ')
            .replace(/\s*,\s*,+/g,', ')
            .replace(/\s{2,}/g,' ')
            .trim();

    const getDateLabel = (scope,from,to) => {
        if (scope === 'ALL') return 'All Dates';
        if (scope === 'RANGE') {
            if (from && to) return `${from} to ${to}`;
            if (from) return `From ${from}`;
            return `Through ${to}`;
        }
        return 'Today';
    };

    const normalizeKey = (value) => String(value || '').toLowerCase().replace(/[^a-z0-9]/g,'');
    const trim = (value) => String(value || '').replace(/^\s+|\s+$/g,'');
    const escapeXml = (value) =>
        String(value === null || value === undefined ? '' : value)
            .replace(/&/g,'&amp;')
            .replace(/</g,'&lt;')
            .replace(/>/g,'&gt;')
            .replace(/"/g,'&quot;')
            .replace(/'/g,'&apos;');

    return { onRequest };
});
