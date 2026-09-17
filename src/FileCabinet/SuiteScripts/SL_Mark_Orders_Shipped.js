/**
 * @NApiVersion 2.1
 * @NScriptType Suitelet
 *
 * Simplex Mark Orders Shipped
 *
 * Purpose:
 * - Shows Item Fulfillments currently in Packed status.
 * - Lets user select fulfillments and mark them Shipped.
 * - Filters by Order #, Fulfillment #, Trip #, Picker, Truck Number, and Location.
 *
 * Notes:
 * - This version removes Truck Driver completely.
 * - This version does not show or update Weight / Tracking Number.
 * - Custom filter fields are post-filtered in script after the base search.
 *   This avoids NetSuite UNEXPECTED_ERROR issues from custom body field filters
 *   on Item Fulfillment transaction searches.
 */
define([
    'N/ui/serverWidget',
    'N/search',
    'N/record',
    'N/runtime',
    'N/task',
    'N/log',
    'N/redirect'
], (
    serverWidget,
    search,
    record,
    runtime,
    task,
    log,
    redirect
) => {

    const PAGE_SIZE = 1000;
    const MAX_SEARCH_PAGES = 5;

    const ACTION_LOAD_FULFILLMENT_ITEMS = 'load_fulfillment_items';
    const PARAM_ACTION = 'custpage_action';
    const PARAM_FULFILLMENT_ID = 'custpage_fulfillment_id';

    const SEARCH_STATUS_PACKED = 'ItemShip:B';
    const RECORD_STATUS_SHIPPED = 'C';

    const PARAM_SCHEDULED_SCRIPT_ID = 'custscript_mop_sched_script_id';
    const PARAM_SCHEDULED_DEPLOY_ID = 'custscript_mop_sched_deploy_id';
    const PARAM_SYNC_LIMIT = 'custscript_mop_sync_limit';

    const SCHED_PARAM_PAYLOAD = 'custscript_mop_payload';

    function onRequest(context) {
        try {
            if (context.request.method === 'GET') {
                if (context.request.parameters[PARAM_ACTION] === ACTION_LOAD_FULFILLMENT_ITEMS) {
                    writeFulfillmentItemsResponse(context);
                    return;
                }

                renderForm(context);
            } else {
                processSubmit(context);
            }
        } catch (e) {
            log.error({
                title: 'Simplex Mark Orders Shipped Suitelet Error',
                details: e
            });

            renderErrorPage(context, e);
        }
    }

    function renderForm(context, message) {
        const request = context.request;
        const params = request.parameters || {};

        if (!message && params.custpage_message_text) {
            message = params.custpage_message_text;
        }

        const form = serverWidget.createForm({
            title: 'Simplex Mark Orders Shipped'
        });

        form.addSubmitButton({
            label: 'Submit'
        });

        addInlineButtons(form);

        if (message) {
            const msg = form.addField({
                id: 'custpage_message',
                label: 'Message',
                type: serverWidget.FieldType.INLINEHTML
            });

            msg.defaultValue = `
                <div style="padding:10px;margin:10px 0;border:1px solid #b7d4ea;background:#f4faff;">
                    ${escapeHtml(message)}
                </div>
            `;
        }

        const payload = form.addField({
            id: 'custpage_ship_payload',
            label: 'Ship Payload',
            type: serverWidget.FieldType.LONGTEXT
        });

        payload.updateDisplayType({
            displayType: serverWidget.FieldDisplayType.HIDDEN
        });

        addFilterFields(form, params);
        addFulfillmentTable(form, params);

        context.response.writePage(form);
    }

    function addInlineButtons(form) {
        const html = form.addField({
            id: 'custpage_inline_buttons',
            label: 'Buttons',
            type: serverWidget.FieldType.INLINEHTML
        });

        html.defaultValue = `
            <div style="margin:8px 0 12px 0;">
                <button type="button" onclick="refreshShippedFilters()">Refresh</button>
                <button type="button" onclick="markAllShippedRows()">Mark All</button>
                <button type="button" onclick="unmarkAllShippedRows()">Unmark All</button>
            </div>
        `;
    }

    function addFilterFields(form, params) {
        form.addFieldGroup({
            id: 'custpage_filters',
            label: 'Filters'
        });

        const orderNumber = form.addField({
            id: 'custpage_ordernumber',
            label: 'Select Order Number',
            type: serverWidget.FieldType.TEXT,
            container: 'custpage_filters'
        });
        orderNumber.defaultValue = params.custpage_ordernumber || '';

        const fulfillmentNumber = form.addField({
            id: 'custpage_fulfillmentnumber',
            label: 'Fulfillment #',
            type: serverWidget.FieldType.TEXT,
            container: 'custpage_filters'
        });
        fulfillmentNumber.defaultValue = params.custpage_fulfillmentnumber || '';

        const tripNumber = form.addField({
            id: 'custpage_trip_number',
            label: 'Trip #',
            type: serverWidget.FieldType.TEXT,
            container: 'custpage_filters'
        });
        tripNumber.defaultValue = params.custpage_trip_number || '';

        const picker = form.addField({
            id: 'custpage_picker',
            label: 'Picker',
            type: serverWidget.FieldType.SELECT,
            source: 'customlist_spx_pickers',
            container: 'custpage_filters'
        });
        picker.defaultValue = params.custpage_picker || '';

        const truck = form.addField({
            id: 'custpage_truck',
            label: 'Truck Number',
            type: serverWidget.FieldType.SELECT,
            source: 'customlist_truck_fulfillment',
            container: 'custpage_filters'
        });
        truck.defaultValue = params.custpage_truck || '';

        const location = form.addField({
            id: 'custpage_location',
            label: 'Location',
            type: serverWidget.FieldType.SELECT,
            source: 'location',
            container: 'custpage_filters'
        });
        location.defaultValue = params.custpage_location || '';
    }

    function addFulfillmentTable(form, params) {
        const html = form.addField({
            id: 'custpage_fulfillment_html',
            label: 'Fulfillments',
            type: serverWidget.FieldType.INLINEHTML
        });

        html.updateLayoutType({
            layoutType: serverWidget.FieldLayoutType.OUTSIDEBELOW
        });

        let fulfillments = [];
        let errorMessage = '';

        try {
            fulfillments = getPackedFulfillments(params);
        } catch (e) {
            log.error({
                title: 'Failed to load packed fulfillments',
                details: e
            });

            errorMessage = 'Unable to load packed fulfillments. Please check the script execution log for details.';
        }

        html.defaultValue = buildTableHtml(fulfillments, errorMessage);
    }

    function getPackedFulfillments(params) {
        /*
         * Keep the actual NetSuite search filters conservative.
         * The custom body filters are applied after results are returned.
         * This avoids UNEXPECTED_ERROR from custom fields that may not filter reliably
         * on Item Fulfillment transaction searches in some accounts/forms.
         */
        const filters = [
            ['type', 'anyof', 'ItemShip'],
            'AND',
            ['mainline', 'is', 'T'],
            'AND',
            ['status', 'anyof', SEARCH_STATUS_PACKED]
        ];

        if (params.custpage_fulfillmentnumber) {
            filters.push(
                'AND',
                ['tranid', 'contains', params.custpage_fulfillmentnumber]
            );
        }

        if (params.custpage_location) {
            filters.push(
                'AND',
                ['location', 'anyof', params.custpage_location]
            );
        }

        log.debug({
            title: 'Mark Orders Shipped Filters',
            details: JSON.stringify({
                orderNumber: params.custpage_ordernumber || '',
                fulfillmentNumber: params.custpage_fulfillmentnumber || '',
                tripNumber: params.custpage_trip_number || '',
                picker: params.custpage_picker || '',
                truck: params.custpage_truck || '',
                location: params.custpage_location || ''
            })
        });

        const columns = [
            search.createColumn({ name: 'trandate', sort: search.Sort.DESC }),
            search.createColumn({ name: 'tranid' }),
            search.createColumn({ name: 'createdfrom' }),
            search.createColumn({ name: 'entity' }),
            search.createColumn({ name: 'shipmethod' }),
            search.createColumn({ name: 'location' }),
            search.createColumn({ name: 'custbody_simplex_trip_number' }),
            search.createColumn({ name: 'custbody_simplex_picked_by' }),
            search.createColumn({ name: 'custbody_truck' }),
            search.createColumn({ name: 'type', join: 'createdFrom' }),
            search.createColumn({ name: 'tranid', join: 'createdFrom' })
        ];

        const fulfillmentSearch = search.create({
            type: search.Type.ITEM_FULFILLMENT,
            filters,
            columns
        });

        const paged = fulfillmentSearch.runPaged({
            pageSize: PAGE_SIZE
        });

        const results = [];

        const orderNumberFilter = normalize(params.custpage_ordernumber);
        const tripNumberFilter = normalize(params.custpage_trip_number);
        const pickerFilter = normalize(params.custpage_picker);
        const truckFilter = normalize(params.custpage_truck);

        const pageRanges = paged.pageRanges.slice(0, MAX_SEARCH_PAGES);

        pageRanges.forEach(pageRange => {
            const page = paged.fetch({
                index: pageRange.index
            });

            page.data.forEach(result => {
                const orderNumber = result.getValue({
                    name: 'tranid',
                    join: 'createdFrom'
                }) || '';

                const tripNumberValue = result.getValue('custbody_simplex_trip_number') || '';
                const pickerValue = result.getValue('custbody_simplex_picked_by') || '';
                const truckValue = result.getValue('custbody_truck') || '';

                if (orderNumberFilter && normalize(orderNumber).indexOf(orderNumberFilter) === -1) {
                    return;
                }

                if (tripNumberFilter && normalize(tripNumberValue) !== tripNumberFilter) {
                    return;
                }

                if (pickerFilter && normalize(pickerValue) !== pickerFilter) {
                    return;
                }

                if (truckFilter && normalize(truckValue) !== truckFilter) {
                    return;
                }

                results.push({
                    id: result.id,
                    date: result.getValue('trandate') || '',
                    fulfillmentNumber: result.getValue('tranid') || '',
                    orderId: result.getValue('createdfrom') || '',
                    orderText: result.getText('createdfrom') || orderNumber,
                    orderType: result.getText({
                        name: 'type',
                        join: 'createdFrom'
                    }) || '',
                    customer: result.getText('entity') || '',
                    shipMethod: result.getText('shipmethod') || '',
                    location: result.getText('location') || '',
                    tripNumber: tripNumberValue,
                    picker: result.getText('custbody_simplex_picked_by') || '',
                    truck: result.getText('custbody_truck') || ''
                });
            });
        });

        return results;
    }

    /**
     * Loads one Item Fulfillment only when the user expands its row. The XML
     * record exposes these values directly on the item sublist, so this avoids
     * relying on transaction-search columns that vary by transaction type.
     */
    function writeFulfillmentItemsResponse(context) {
        const fulfillmentId = String(
            context.request.parameters[PARAM_FULFILLMENT_ID] || ''
        );
        let payload;

        try {
            if (!/^\d+$/.test(fulfillmentId)) {
                throw new Error('A valid Item Fulfillment internal ID is required.');
            }

            const items = getFulfillmentItemsFromRecord(fulfillmentId);

            payload = {
                success: true,
                html: buildFulfillmentItemsTable(items)
            };
        } catch (e) {
            log.error({
                title: `Unable to load Item Fulfillment ${fulfillmentId} line details`,
                details: e
            });

            payload = {
                success: false,
                message: 'Unable to load the item lines. Check the Suitelet execution log for details.'
            };
        }

        context.response.setHeader({
            name: 'Content-Type',
            value: 'application/json; charset=UTF-8'
        });

        context.response.write({
            output: JSON.stringify(payload)
        });
    }

    function getFulfillmentItemsFromRecord(fulfillmentId) {
        const fulfillment = record.load({
            type: record.Type.ITEM_FULFILLMENT,
            id: fulfillmentId,
            isDynamic: false
        });

        const lineCount = fulfillment.getLineCount({
            sublistId: 'item'
        });
        const items = [];

        for (let line = 0; line < lineCount; line++) {
            const itemReceive = getSublistValueSafe(
                fulfillment,
                'item',
                'itemreceive',
                line
            );

            if (itemReceive === false || itemReceive === 'F') {
                continue;
            }

            const itemId = getSublistValueSafe(fulfillment, 'item', 'item', line);
            const itemName =
                getSublistTextSafe(fulfillment, 'item', 'item', line) ||
                getSublistValueSafe(fulfillment, 'item', 'itemname', line) ||
                getSublistValueSafe(fulfillment, 'item', 'sitemname', line) ||
                itemId;

            if (!itemId && !itemName) {
                continue;
            }

            const orderLine = getSublistValueSafe(
                fulfillment,
                'item',
                'orderline',
                line
            );
            const quantityValue = getSublistValueSafe(
                fulfillment,
                'item',
                'quantity',
                line
            );
            const unit =
                getSublistValueSafe(fulfillment, 'item', 'unitsdisplay', line) ||
                getSublistTextSafe(fulfillment, 'item', 'units', line) ||
                getSublistValueSafe(fulfillment, 'item', 'units', line) ||
                '';

            items.push({
                line: orderLine !== '' ? orderLine : line + 1,
                item: itemName,
                displayName: getSublistValueSafe(
                    fulfillment,
                    'item',
                    'displayname',
                    line
                ),
                description:
                    getSublistValueSafe(fulfillment, 'item', 'description', line) ||
                    getSublistValueSafe(fulfillment, 'item', 'itemdescription', line) ||
                    '',
                quantity: formatDisplayNumber(Math.abs(Number(quantityValue || 0))),
                unit
            });
        }

        return items;
    }

    function getSublistValueSafe(rec, sublistId, fieldId, line) {
        try {
            const value = rec.getSublistValue({
                sublistId,
                fieldId,
                line
            });

            return value === null || value === undefined ? '' : value;
        } catch (e) {
            return '';
        }
    }

    function getSublistTextSafe(rec, sublistId, fieldId, line) {
        try {
            return rec.getSublistText({
                sublistId,
                fieldId,
                line
            }) || '';
        } catch (e) {
            return '';
        }
    }

    function buildFulfillmentItemsTable(items) {
        if (!items || !items.length) {
            return `
                <div class="no-item-lines">
                    No item lines found on this Item Fulfillment.
                </div>
            `;
        }

        const itemRows = items.map(line => {
            return `
                <tr>
                    <td>${escapeHtml(line.line)}</td>
                    <td>${escapeHtml(line.item)}</td>
                    <td>${escapeHtml(line.displayName)}</td>
                    <td class="item-description">${escapeHtml(line.description)}</td>
                    <td class="right">${escapeHtml(line.quantity)}</td>
                    <td>${escapeHtml(line.unit)}</td>
                </tr>
            `;
        }).join('');

        return `
            <table class="items-table">
                <thead>
                    <tr>
                        <th>Line</th>
                        <th>Item</th>
                        <th>Display Name</th>
                        <th>Description</th>
                        <th>Fulfilled Qty</th>
                        <th>UM</th>
                    </tr>
                </thead>
                <tbody>
                    ${itemRows}
                </tbody>
            </table>
        `;
    }

    function buildTableHtml(rows, errorMessage) {
        let rowsHtml = '';

        if (errorMessage) {
            rowsHtml = `
                <tr>
                    <td colspan="12" style="text-align:center;padding:14px;color:#b00020;">
                        ${escapeHtml(errorMessage)}
                    </td>
                </tr>
            `;
        } else if (!rows.length) {
            rowsHtml = `
                <tr>
                    <td colspan="12" style="text-align:center;padding:14px;">
                        No packed item fulfillments found.
                    </td>
                </tr>
            `;
        } else {
            rows.forEach(row => {
                const itemRowId = `fulfillment_items_${String(row.id).replace(/[^A-Za-z0-9_-]/g, '_')}`;

                rowsHtml += `
                    <tr class="fulfillment-row" data-ifid="${escapeHtml(row.id)}">
                        <td class="center">
                            <button type="button"
                                    class="expand-btn"
                                    aria-expanded="false"
                                    title="Show Item Fulfillment items"
                                    onclick="toggleFulfillmentItems('${itemRowId}', this)">+</button>
                        </td>
                        <td class="center">
                            <input type="checkbox" class="ship-check" data-ifid="${escapeHtml(row.id)}">
                        </td>
                        <td>${escapeHtml(row.date)}</td>
                        <td>${escapeHtml(row.fulfillmentNumber)}</td>
                        <td>${escapeHtml(row.orderType)}</td>
                        <td>${escapeHtml(row.orderText)}</td>
                        <td>${escapeHtml(row.customer)}</td>
                        <td>${escapeHtml(row.shipMethod)}</td>
                        <td>${escapeHtml(row.location)}</td>
                        <td>${escapeHtml(row.tripNumber)}</td>
                        <td>${escapeHtml(row.picker)}</td>
                        <td>${escapeHtml(row.truck)}</td>
                    </tr>
                    <tr id="${itemRowId}"
                        class="items-row"
                        data-ifid="${escapeHtml(row.id)}"
                        data-loaded="false"
                        data-loading="false"
                        style="display:none;">
                        <td colspan="12">
                            <div class="item-details-content">
                                <div class="item-details-message">Loading item lines...</div>
                            </div>
                        </td>
                    </tr>
                `;
            });
        }

        return `
            <style>
                .shipped-page {
                    width: calc(100vw - 40px);
                    margin-top: 10px;
                    font-family: Arial, Helvetica, sans-serif;
                }

                .shipped-table-wrapper {
                    width: 100%;
                    overflow-x: auto;
                    border: 1px solid #d7d7d7;
                    background: #fff;
                }

                .shipped-table {
                    width: 100%;
                    min-width: 1250px;
                    border-collapse: collapse;
                    font-size: 12px;
                }

                .shipped-table th {
                    background: #f5f5f5;
                    border: 1px solid #d0d0d0;
                    padding: 6px;
                    text-align: left;
                    white-space: nowrap;
                }

                .shipped-table td {
                    border: 1px solid #e1e1e1;
                    padding: 5px;
                    white-space: nowrap;
                }

                .shipped-table tr.fulfillment-row:hover > td {
                    background: #eef6fb;
                }

                .center {
                    text-align: center;
                }

                .right {
                    text-align: right;
                }

                .expand-btn {
                    width: 22px;
                    height: 22px;
                    padding: 0;
                    cursor: pointer;
                    font-weight: bold;
                    border: 1px solid #b5b5b5;
                    background: #ffffff;
                    border-radius: 2px;
                    line-height: 18px;
                }

                .expand-btn:hover {
                    background: #f4f4f4;
                }

                .items-row > td {
                    padding: 0;
                    background: #fbfbfb;
                    white-space: normal;
                }

                .items-table {
                    width: calc(100% - 30px);
                    margin: 6px 0 10px 30px;
                    border-collapse: collapse;
                    font-size: 12px;
                    background: #ffffff;
                }

                .items-table th {
                    background: #f7f7f7;
                    border: 1px solid #d0d0d0;
                    padding: 5px 4px;
                    text-align: left;
                    white-space: nowrap;
                    font-weight: 600;
                }

                .items-table td {
                    background: #ffffff;
                    border: 1px solid #e1e1e1;
                    padding: 5px 4px;
                    vertical-align: top;
                    white-space: nowrap;
                }

                .items-table .item-description {
                    min-width: 260px;
                    white-space: normal;
                }

                .no-item-lines {
                    padding: 8px 12px 10px 30px;
                    color: #555555;
                }

                .item-details-message {
                    padding: 8px 12px 10px 30px;
                    color: #555555;
                }

                .item-details-error {
                    color: #a12622;
                }
            </style>

            <div class="shipped-page">
                <div class="shipped-table-wrapper">
                    <table class="shipped-table">
                        <thead>
                            <tr>
                                <th></th>
                                <th>Ship</th>
                                <th>Date</th>
                                <th>Fulfillment #</th>
                                <th>Order Type</th>
                                <th>Order #</th>
                                <th>Customer Name</th>
                                <th>Ship Method</th>
                                <th>Location</th>
                                <th>Trip #</th>
                                <th>Picker</th>
                                <th>Truck Number</th>
                            </tr>
                        </thead>
                        <tbody>
                            ${rowsHtml}
                        </tbody>
                    </table>
                </div>
            </div>

            <script>
                async function toggleFulfillmentItems(rowId, button) {
                    var row = document.getElementById(rowId);

                    if (!row) {
                        return;
                    }

                    if (row.style.display === 'none') {
                        row.style.display = '';
                        button.textContent = '-';
                        button.setAttribute('aria-expanded', 'true');

                        if (
                            row.getAttribute('data-loaded') !== 'true' &&
                            row.getAttribute('data-loading') !== 'true'
                        ) {
                            await loadFulfillmentItems(row);
                        }
                    } else {
                        row.style.display = 'none';
                        button.textContent = '+';
                        button.setAttribute('aria-expanded', 'false');
                    }
                }

                async function loadFulfillmentItems(row) {
                    var fulfillmentId = row.getAttribute('data-ifid') || '';
                    var content = row.querySelector('.item-details-content');

                    if (!content || !fulfillmentId) {
                        return;
                    }

                    row.setAttribute('data-loading', 'true');
                    setItemDetailsMessage(content, 'Loading item lines...', false);

                    try {
                        var itemUrl = new URL(window.location.href);

                        itemUrl.searchParams.set('custpage_action', 'load_fulfillment_items');
                        itemUrl.searchParams.set('custpage_fulfillment_id', fulfillmentId);

                        var response = await fetch(itemUrl.toString(), {
                            method: 'GET',
                            credentials: 'same-origin',
                            headers: {
                                'X-Requested-With': 'XMLHttpRequest'
                            }
                        });

                        if (!response.ok) {
                            throw new Error('NetSuite returned HTTP ' + response.status + '.');
                        }

                        var result = await response.json();

                        if (!result || result.success !== true) {
                            throw new Error(
                                result && result.message
                                    ? result.message
                                    : 'The Suitelet did not return the item lines.'
                            );
                        }

                        content.innerHTML = result.html || '';
                        row.setAttribute('data-loaded', 'true');
                    } catch (e) {
                        setItemDetailsMessage(
                            content,
                            'Unable to load item lines. ' + (e && e.message ? e.message : ''),
                            true
                        );
                    } finally {
                        row.setAttribute('data-loading', 'false');
                    }
                }

                function setItemDetailsMessage(container, message, isError) {
                    var messageElement = document.createElement('div');

                    messageElement.className = isError
                        ? 'item-details-message item-details-error'
                        : 'item-details-message';
                    messageElement.textContent = message || '';

                    container.innerHTML = '';
                    container.appendChild(messageElement);
                }

                function markAllShippedRows() {
                    document.querySelectorAll('.ship-check').forEach(function(cb) {
                        cb.checked = true;
                    });
                }

                function unmarkAllShippedRows() {
                    document.querySelectorAll('.ship-check').forEach(function(cb) {
                        cb.checked = false;
                    });
                }

                function refreshShippedFilters() {
                    var currentUrl = new URL(window.location.href);

                    currentUrl.searchParams.delete('custpage_message_text');
                    currentUrl.searchParams.delete('custpage_ordernumber');
                    currentUrl.searchParams.delete('custpage_fulfillmentnumber');
                    currentUrl.searchParams.delete('custpage_trip_number');
                    currentUrl.searchParams.delete('custpage_picker');
                    currentUrl.searchParams.delete('custpage_truck');
                    currentUrl.searchParams.delete('custpage_location');

                    var orderNumber = getNsFieldValue('custpage_ordernumber');
                    var fulfillmentNumber = getNsFieldValue('custpage_fulfillmentnumber');
                    var tripNumber = getNsFieldValue('custpage_trip_number');
                    var picker = getNsFieldValue('custpage_picker');
                    var truck = getNsFieldValue('custpage_truck');
                    var location = getNsFieldValue('custpage_location');

                    if (orderNumber) {
                        currentUrl.searchParams.set('custpage_ordernumber', orderNumber);
                    }

                    if (fulfillmentNumber) {
                        currentUrl.searchParams.set('custpage_fulfillmentnumber', fulfillmentNumber);
                    }

                    if (tripNumber) {
                        currentUrl.searchParams.set('custpage_trip_number', tripNumber);
                    }

                    if (picker) {
                        currentUrl.searchParams.set('custpage_picker', picker);
                    }

                    if (truck) {
                        currentUrl.searchParams.set('custpage_truck', truck);
                    }

                    if (location) {
                        currentUrl.searchParams.set('custpage_location', location);
                    }

                    window.location.href = currentUrl.toString();
                }

                function getNsFieldValue(fieldId) {
                    try {
                        if (typeof nlapiGetFieldValue === 'function') {
                            var nlapiValue = nlapiGetFieldValue(fieldId);
                            if (nlapiValue) {
                                return nlapiValue;
                            }
                        }
                    } catch (e) {}

                    var byId = document.getElementById(fieldId);
                    if (byId && byId.value) {
                        return byId.value;
                    }

                    var byName = document.getElementsByName(fieldId);
                    if (byName && byName.length && byName[0].value) {
                        return byName[0].value;
                    }

                    var hiddenInput = document.querySelector('input[name="' + fieldId + '"]');
                    if (hiddenInput && hiddenInput.value) {
                        return hiddenInput.value;
                    }

                    var selectInput = document.querySelector('select[name="' + fieldId + '"]');
                    if (selectInput && selectInput.value) {
                        return selectInput.value;
                    }

                    return '';
                }

                document.addEventListener('submit', function() {
                    var payload = [];

                    document.querySelectorAll('.ship-check:checked').forEach(function(cb) {
                        var ifId = cb.getAttribute('data-ifid');

                        payload.push({
                            fulfillmentId: ifId
                        });
                    });

                    var payloadField = document.getElementById('custpage_ship_payload');
                    if (payloadField) {
                        payloadField.value = JSON.stringify(payload);
                    }
                });
            </script>
        `;
    }

    function processSubmit(context) {
        const request = context.request;
        const payloadText = request.parameters.custpage_ship_payload || '[]';

        let payload = [];

        try {
            payload = JSON.parse(payloadText);
        } catch (e) {
            redirectToSuitelet('Invalid payload. Please try again.');
            return;
        }

        if (!payload.length) {
            redirectToSuitelet('Please select at least one fulfillment to mark shipped.');
            return;
        }

        const currentScript = runtime.getCurrentScript();

        const syncLimit = Number(
            currentScript.getParameter({ name: PARAM_SYNC_LIMIT }) || 25
        );

        if (payload.length > syncLimit) {
            const scheduledScriptId = currentScript.getParameter({
                name: PARAM_SCHEDULED_SCRIPT_ID
            });

            const scheduledDeploymentId = currentScript.getParameter({
                name: PARAM_SCHEDULED_DEPLOY_ID
            });

            if (!scheduledScriptId || !scheduledDeploymentId) {
                redirectToSuitelet(
                    `Selected ${payload.length} fulfillments, but the scheduled script parameters are not configured.`
                );
                return;
            }

            const scheduledTask = task.create({
                taskType: task.TaskType.SCHEDULED_SCRIPT,
                scriptId: scheduledScriptId,
                deploymentId: scheduledDeploymentId,
                params: {
                    [SCHED_PARAM_PAYLOAD]: JSON.stringify(payload)
                }
            });

            const taskId = scheduledTask.submit();

            redirectToSuitelet(
                `Submitted ${payload.length} fulfillments for background shipping. Task ID: ${taskId}`
            );

            return;
        }

        const result = markFulfillmentsShipped(payload);

        redirectToSuitelet(
            `Shipped ${result.success} fulfillment(s). Failed: ${result.failed}.`
        );
    }

    function markFulfillmentsShipped(payload) {
        let success = 0;
        let failed = 0;

        payload.forEach(line => {
            try {
                const fulfillmentId = line && line.fulfillmentId;

                if (!fulfillmentId) {
                    failed++;
                    return;
                }

                record.submitFields({
                    type: record.Type.ITEM_FULFILLMENT,
                    id: fulfillmentId,
                    values: {
                        shipstatus: RECORD_STATUS_SHIPPED
                    },
                    options: {
                        enableSourcing: false,
                        ignoreMandatoryFields: true
                    }
                });

                success++;
            } catch (e) {
                failed++;

                log.error({
                    title: `Failed to ship fulfillment ${line && line.fulfillmentId}`,
                    details: e
                });
            }
        });

        return { success, failed };
    }

    function redirectToSuitelet(message) {
        const currentScript = runtime.getCurrentScript();

        redirect.toSuitelet({
            scriptId: currentScript.id,
            deploymentId: currentScript.deploymentId,
            parameters: {
                custpage_message_text: message || ''
            }
        });
    }

    function renderErrorPage(context, error) {
        const form = serverWidget.createForm({
            title: 'Simplex Mark Orders Shipped - Error'
        });

        const msg = form.addField({
            id: 'custpage_error',
            label: 'Error',
            type: serverWidget.FieldType.INLINEHTML
        });

        msg.defaultValue = `
            <div style="padding:12px;margin:12px 0;border:1px solid #d9534f;background:#fff5f5;color:#8a1f11;">
                <strong>An error occurred.</strong><br>
                ${escapeHtml(error && (error.message || error.name) || 'Unexpected error')}
            </div>
        `;

        context.response.writePage(form);
    }

    function normalize(value) {
        if (value === null || value === undefined) {
            return '';
        }

        return String(value).trim().toLowerCase();
    }

    function escapeHtml(value) {
        if (value === null || value === undefined) {
            return '';
        }

        return String(value)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#039;');
    }

    function formatDisplayNumber(value) {
        const number = Number(value || 0);

        if (!Number.isFinite(number)) {
            return '0';
        }

        if (Number.isInteger(number)) {
            return String(number);
        }

        return String(Math.round(number * 10000) / 10000);
    }

    return {
        onRequest
    };
});
