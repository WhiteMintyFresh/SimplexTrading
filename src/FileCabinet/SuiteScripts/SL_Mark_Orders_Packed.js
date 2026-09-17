/**
 * @NApiVersion 2.1
 * @NScriptType Suitelet
 */
define([
    'N/ui/serverWidget',
    'N/search',
    'N/record',
    'N/runtime',
    'N/task',
    'N/log'
], (
    serverWidget,
    search,
    record,
    runtime,
    task,
    log
) => {

    const PAGE_SIZE = 500;

    const ACTION_LOAD_FULFILLMENT_ITEMS = 'load_fulfillment_items';
    const PARAM_ACTION = 'custpage_action';
    const PARAM_FULFILLMENT_ID = 'custpage_fulfillment_id';

    const SEARCH_STATUS_PICKED = 'ItemShip:A';
    const RECORD_STATUS_PACKED = 'B';

    const PARAM_SCHEDULED_SCRIPT_ID = 'custscript_mop_sched_script_id';
    const PARAM_SCHEDULED_DEPLOY_ID = 'custscript_mop_sched_deploy_id';
    const PARAM_SYNC_LIMIT = 'custscript_mop_sync_limit';

const SCHED_PARAM_PAYLOAD = 'custscript_mop_payload';

const PICKER_FIELD_ID = 'custbody_simplex_picked_by';
const TRUCK_FIELD_ID = 'custbody_truck';
const TRIP_NUMBER_FIELD_ID = 'custbody_simplex_trip_number';

const FLD_SET_PICKER = 'custpage_set_picker';
const FLD_SET_TRUCK = 'custpage_set_truck';
const FLD_SET_TRIP_NUMBER = 'custpage_set_trip_number';

    function onRequest(context) {
        if (context.request.method === 'GET') {
            if (context.request.parameters[PARAM_ACTION] === ACTION_LOAD_FULFILLMENT_ITEMS) {
                writeFulfillmentItemsResponse(context);
                return;
            }

            renderForm(context);
        } else {
            processSubmit(context);
        }
    }

    function renderForm(context, message) {
        const request = context.request;
        const params = request.parameters || {};

        const form = serverWidget.createForm({
            title: 'Simplex Mark Orders Picked/Loaded'
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
            id: 'custpage_pack_payload',
            label: 'Pack Payload',
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
                <button type="button" onclick="refreshPackedFilters()">Refresh</button>
                <button type="button" onclick="markAllPackedRows()">Mark All</button>
                <button type="button" onclick="unmarkAllPackedRows()">Unmark All</button>
            </div>
        `;
    }

    function addFilterFields(form, params) {
        form.addFieldGroup({
            id: 'custpage_filters',
            label: 'Filters'
        });

        form.addFieldGroup({
            id: 'custpage_set_values',
            label: 'Set Fulfillment Values'
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

        const setPicker = form.addField({
            id: FLD_SET_PICKER,
            label: 'Picker',
            type: serverWidget.FieldType.SELECT,
            source: 'customlist_spx_pickers',
            container: 'custpage_set_values'
        });
        setPicker.defaultValue = params[FLD_SET_PICKER] || '';

        const setTruck = form.addField({
            id: FLD_SET_TRUCK,
            label: 'Truck Number',
            type: serverWidget.FieldType.SELECT,
            source: 'customlist_truck_fulfillment',
            container: 'custpage_set_values'
        });
        setTruck.defaultValue = params[FLD_SET_TRUCK] || '';

        const setTripNumber = form.addField({
            id: FLD_SET_TRIP_NUMBER,
            label: 'Trip #',
            type: serverWidget.FieldType.TEXT,
            container: 'custpage_set_values'
        });
        setTripNumber.defaultValue = params[FLD_SET_TRIP_NUMBER] || '';
    }

    function addFulfillmentTable(form, params) {
        const fulfillments = getPickedFulfillments(params);
        const pickerOptions = getCustomListOptions('customlist_spx_pickers');
        const truckOptions = getCustomListOptions('customlist_truck_fulfillment');

        const html = form.addField({
            id: 'custpage_fulfillment_html',
            label: 'Fulfillments',
            type: serverWidget.FieldType.INLINEHTML
        });

        html.updateLayoutType({
            layoutType: serverWidget.FieldLayoutType.OUTSIDEBELOW
        });

        html.defaultValue = buildTableHtml(fulfillments, pickerOptions, truckOptions);
    }

    function getPickedFulfillments(params) {
        const filters = [
            ['type', 'anyof', 'ItemShip'],
            'AND',
            ['mainline', 'is', 'T'],
            'AND',
            ['status', 'anyof', SEARCH_STATUS_PICKED]
        ];

        if (params.custpage_fulfillmentnumber) {
            filters.push(
                'AND',
                ['tranid', 'contains', params.custpage_fulfillmentnumber]
            );
        }

        if (params.custpage_picker) {
            filters.push(
                'AND',
                [PICKER_FIELD_ID, 'anyof', params.custpage_picker]
            );
        }
        if (params.custpage_truck) {
            filters.push(
                'AND',
                [TRUCK_FIELD_ID, 'anyof', params.custpage_truck]
            );
        }

        if (params.custpage_location) {
            filters.push(
                'AND',
                ['location', 'anyof', params.custpage_location]
            );
        }

        log.debug({
            title: 'Mark Orders Picked/Loaded Filters',
            details: JSON.stringify({
                orderNumber: params.custpage_ordernumber,
                fulfillmentNumber: params.custpage_fulfillmentnumber,
                tripNumber: params.custpage_trip_number,
                picker: params.custpage_picker,
                truck: params.custpage_truck,
                location: params.custpage_location
            })
        });

        const columns = [
            search.createColumn({ name: 'trandate', sort: search.Sort.DESC }),
            search.createColumn({ name: 'tranid' }),
            search.createColumn({ name: 'createdfrom' }),
            search.createColumn({ name: 'entity' }),
            search.createColumn({ name: 'shipmethod' }),
            search.createColumn({ name: 'location' }),
            search.createColumn({ name: PICKER_FIELD_ID }),
            search.createColumn({ name: TRUCK_FIELD_ID }),
            search.createColumn({ name: 'custbody_simplex_trip_number' }),
            search.createColumn({ name: 'type', join: 'createdFrom' }),
            search.createColumn({ name: 'tranid', join: 'createdFrom' })
        ];

        const results = [];

        const fulfillmentSearch = search.create({
            type: search.Type.ITEM_FULFILLMENT,
            filters,
            columns
        });

        const paged = fulfillmentSearch.runPaged({
            pageSize: PAGE_SIZE
        });

        paged.pageRanges.slice(0, 1).forEach(pageRange => {
            const page = paged.fetch({ index: pageRange.index });

            page.data.forEach(result => {
                const orderNumber = result.getValue({
                    name: 'tranid',
                    join: 'createdFrom'
                }) || '';

                if (params.custpage_ordernumber) {
                    const needle = String(params.custpage_ordernumber).toLowerCase();
                    const haystack = String(orderNumber).toLowerCase();

                    if (!haystack.includes(needle)) {
                        return;
                    }
                }

                const tripValue = result.getValue('custbody_simplex_trip_number') || '';
                const tripText = result.getText('custbody_simplex_trip_number') || tripValue || '';

                /*
                 * Trip # is filtered here after search retrieval so it works whether
                 * custbody_simplex_trip_number is a text/number field or a list field.
                 */
                if (params.custpage_trip_number) {
                    const needle = String(params.custpage_trip_number).toLowerCase();
                    const tripTextMatch = String(tripText).toLowerCase().indexOf(needle) !== -1;
                    const tripValueMatch = String(tripValue).toLowerCase().indexOf(needle) !== -1;

                    if (!tripTextMatch && !tripValueMatch) {
                        return;
                    }
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
                    orderTypeCode: result.getValue({
                        name: 'type',
                        join: 'createdFrom'
                    }) || '',
                    customer: result.getText('entity') || '',
                    shipMethod: result.getText('shipmethod') || '',
                    location: result.getText('location') || '',
                    pickerId: result.getValue(PICKER_FIELD_ID) || '',
                    picker: result.getText(PICKER_FIELD_ID) || '',
                    truckId: result.getValue(TRUCK_FIELD_ID) || '',
                    truck: result.getText(TRUCK_FIELD_ID) || '',
                    tripNumber: tripText
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

    function getCustomListOptions(listScriptId) {
        const options = [
            {
                id: '',
                name: ''
            }
        ];

        try {
            const listSearch = search.create({
                type: listScriptId,
                filters: [
                    ['isinactive', 'is', 'F']
                ],
                columns: [
                    search.createColumn({
                        name: 'name',
                        sort: search.Sort.ASC
                    }),
                    search.createColumn({
                        name: 'internalid'
                    })
                ]
            });

            listSearch.run().each(result => {
                const id = result.getValue({
                    name: 'internalid'
                });

                const name = result.getValue({
                    name: 'name'
                });

                if (id && name) {
                    options.push({
                        id: String(id),
                        name: String(name)
                    });
                }

                return true;
            });
        } catch (e) {
            log.error({
                title: `Unable to load custom list options: ${listScriptId}`,
                details: e
            });
        }

        return options;
    }

    function buildSelectOptions(options, selectedValue) {
        return (options || []).map(option => {
            const selected = String(option.id) === String(selectedValue || '') ? 'selected' : '';

            return `
                <option value="${escapeHtml(option.id)}" ${selected}>
                    ${escapeHtml(option.name)}
                </option>
            `;
        }).join('');
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

    function buildTableHtml(rows, pickerOptions, truckOptions) {
        let rowsHtml = '';

        if (!rows.length) {
            rowsHtml = `
                <tr>
                    <td colspan="12" style="text-align:center;padding:14px;">
                        No picked item fulfillments found.
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
                            <input type="checkbox"
                                   class="pack-check"
                                   data-ifid="${escapeHtml(row.id)}"
                                   data-orderid="${escapeHtml(row.orderId)}"
                                   data-ordertype="${escapeHtml(row.orderTypeCode)}">
                        </td>
                        <td>${escapeHtml(row.date)}</td>
                        <td>${escapeHtml(row.fulfillmentNumber)}</td>
                        <td>${escapeHtml(row.orderType)}</td>
                        <td>${escapeHtml(row.orderText)}</td>
                        <td>${escapeHtml(row.customer)}</td>
                        <td>${escapeHtml(row.shipMethod)}</td>
                        <td>${escapeHtml(row.location)}</td>
                        <td>
                            <select class="line-picker" data-ifid="${escapeHtml(row.id)}">
                                ${buildSelectOptions(pickerOptions, row.pickerId)}
                            </select>
                        </td>
                        <td>
                            <select class="line-truck" data-ifid="${escapeHtml(row.id)}">
                                ${buildSelectOptions(truckOptions, row.truckId)}
                            </select>
                        </td>
                        <td>
                            <input type="text"
                                   class="line-trip"
                                   data-ifid="${escapeHtml(row.id)}"
                                   value="${escapeHtml(row.tripNumber)}"
                                   maxlength="50">
                        </td>
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
                .packed-page {
                    width: calc(100vw - 40px);
                    margin-top: 10px;
                    font-family: Arial, Helvetica, sans-serif;
                }

                .packed-table-wrapper {
                    width: 100%;
                    overflow-x: auto;
                    border: 1px solid #d7d7d7;
                    background: #fff;
                }

                .packed-table {
                    width: 100%;
                    min-width: 1350px;
                    border-collapse: collapse;
                    font-size: 12px;
                }

                .packed-table th {
                    background: #f5f5f5;
                    border: 1px solid #d0d0d0;
                    padding: 6px;
                    text-align: left;
                    white-space: nowrap;
                }

                .packed-table td {
                    border: 1px solid #e1e1e1;
                    padding: 5px;
                    white-space: nowrap;
                }

                .packed-table tr.fulfillment-row:hover > td {
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

                .line-picker,
                .line-truck,
                .line-trip {
                    width: 150px;
                    background: #ffffff;
                    border: 1px solid #b5b5b5;
                    height: 23px;
                    box-sizing: border-box;
                }
            </style>

            <div class="packed-page">
                <div class="packed-table-wrapper">
                    <table class="packed-table">
                        <thead>
                            <tr>
                                <th></th>
                                <th>Pack</th>
                                <th>Date</th>
                                <th>Fulfillment #</th>
                                <th>Order Type</th>
                                <th>Order #</th>
                                <th>Customer Name</th>
                                <th>Ship Method</th>
                                <th>Location</th>
                                <th>Picker</th>
                                <th>Truck Number</th>
                                <th>Trip #</th>
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

                function markAllPackedRows() {
                    document.querySelectorAll('.pack-check').forEach(function(cb) {
                        cb.checked = true;
                    });

                    applyHeaderValuesToMarkedLines();
                }

                function unmarkAllPackedRows() {
                    document.querySelectorAll('.pack-check').forEach(function(cb) {
                        cb.checked = false;
                    });
                }

                function refreshPackedFilters() {
                    var currentUrl = new URL(window.location.href);

                    currentUrl.searchParams.delete('custpage_ordernumber');
                    currentUrl.searchParams.delete('custpage_fulfillmentnumber');
                    currentUrl.searchParams.delete('custpage_trip_number');
                    currentUrl.searchParams.delete('custpage_picker');
                    currentUrl.searchParams.delete('custpage_truck');
                    currentUrl.searchParams.delete('custpage_location');
                    currentUrl.searchParams.delete('custpage_set_picker');
                    currentUrl.searchParams.delete('custpage_set_truck');
                    currentUrl.searchParams.delete('custpage_set_trip_number');

                    var orderNumber = getNsFieldValue('custpage_ordernumber');
                    var fulfillmentNumber = getNsFieldValue('custpage_fulfillmentnumber');
                    var tripNumber = getNsFieldValue('custpage_trip_number');
                    var picker = getNsFieldValue('custpage_picker');
                    var truck = getNsFieldValue('custpage_truck');
                    var location = getNsFieldValue('custpage_location');
                    var setPicker = getNsFieldValue('custpage_set_picker');
                    var setTruck = getNsFieldValue('custpage_set_truck');
                    var setTripNumber = getNsFieldValue('custpage_set_trip_number');

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

                    if (setPicker) {
                        currentUrl.searchParams.set('custpage_set_picker', setPicker);
                    }

                    if (setTruck) {
                        currentUrl.searchParams.set('custpage_set_truck', setTruck);
                    }

                    if (setTripNumber) {
                        currentUrl.searchParams.set('custpage_set_trip_number', setTripNumber);
                    }

                    window.onbeforeunload = null;
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

                document.addEventListener('change', function(e) {
                    if (
                        e.target &&
                        (
                            e.target.id === 'custpage_set_picker' ||
                            e.target.id === 'custpage_set_truck' ||
                            e.target.id === 'custpage_set_trip_number'
                        )
                    ) {
                        applyHeaderValuesToMarkedLines();
                    }
                });

                function applyHeaderValuesToMarkedLines() {
                    var setPicker = getNsFieldValue('custpage_set_picker');
                    var setTruck = getNsFieldValue('custpage_set_truck');
                    var setTripNumber = getNsFieldValue('custpage_set_trip_number');

                    document.querySelectorAll('.pack-check:checked').forEach(function(cb) {
                        var ifId = cb.getAttribute('data-ifid');

                        if (setPicker) {
                            var picker = document.querySelector('.line-picker[data-ifid="' + ifId + '"]');
                            if (picker) {
                                picker.value = setPicker;
                            }
                        }

                        if (setTruck) {
                            var truck = document.querySelector('.line-truck[data-ifid="' + ifId + '"]');
                            if (truck) {
                                truck.value = setTruck;
                            }
                        }

                        if (setTripNumber) {
                            var tripNumber = document.querySelector('.line-trip[data-ifid="' + ifId + '"]');
                            if (tripNumber) {
                                tripNumber.value = setTripNumber;
                            }
                        }
                    });
                }

                document.addEventListener('submit', function() {
                    var payload = [];

                    var setPicker = getNsFieldValue('custpage_set_picker');
                    var setTruck = getNsFieldValue('custpage_set_truck');
                    var setTripNumber = getNsFieldValue('custpage_set_trip_number');

                    document.querySelectorAll('.pack-check:checked').forEach(function(cb) {
                        var ifId = cb.getAttribute('data-ifid');
                        var sourceOrderId = cb.getAttribute('data-orderid') || '';
                        var sourceOrderType = cb.getAttribute('data-ordertype') || '';
                        var picker = document.querySelector('.line-picker[data-ifid="' + ifId + '"]');
                        var truck = document.querySelector('.line-truck[data-ifid="' + ifId + '"]');
                        var tripNumber = document.querySelector('.line-trip[data-ifid="' + ifId + '"]');

                        payload.push({
                            fulfillmentId: ifId,
                            sourceOrderId: sourceOrderId,
                            sourceOrderType: sourceOrderType,
                            picker: setPicker || (picker ? picker.value : ''),
                            truck: setTruck || (truck ? truck.value : ''),
                            tripNumber: setTripNumber || (tripNumber ? tripNumber.value : '')
                        });
                    });

                    var payloadField = document.getElementById('custpage_pack_payload');
                    if (payloadField) {
                        payloadField.value = JSON.stringify(payload);
                    }
                });
            </script>
        `;
    }

    function processSubmit(context) {
        const request = context.request;
        const payloadText = request.parameters.custpage_pack_payload || '[]';

        let payload = [];

        try {
            payload = JSON.parse(payloadText);
        } catch (e) {
            renderForm(context, 'Invalid payload. Please try again.');
            return;
        }

        if (!payload.length) {
            renderForm(context, 'Please select at least one fulfillment to mark packed.');
            return;
        }

        const setPicker = request.parameters[FLD_SET_PICKER] || '';
        const setTruck = request.parameters[FLD_SET_TRUCK] || '';
        const setTripNumber = request.parameters[FLD_SET_TRIP_NUMBER] || '';

        payload = payload.map(line => {
            return {
                fulfillmentId: line.fulfillmentId,
                sourceOrderId: line.sourceOrderId || '',
                sourceOrderType: line.sourceOrderType || '',
                picker: setPicker || line.picker || '',
                truck: setTruck || line.truck || '',
                tripNumber: setTripNumber || line.tripNumber || ''
            };
        });

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
                renderForm(
                    context,
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

            renderForm(
                context,
                `Submitted ${payload.length} fulfillments for background packing. Task ID: ${taskId}`
            );

            return;
        }

        const result = markFulfillmentsPacked(payload);

        renderForm(
            context,
            `Packed ${result.success} fulfillment(s). Fulfillment failures: ${result.failed}. ` +
            `Sales Orders updated: ${result.salesOrdersUpdated}. ` +
            `Sales Order update failures: ${result.salesOrderUpdateFailed}.`
        );
    }

    function markFulfillmentsPacked(payload) {
        let success = 0;
        let failed = 0;
        let salesOrdersUpdated = 0;
        let salesOrderUpdateFailed = 0;
        const salesOrderUpdates = {};

        payload.forEach(line => {
            try {
                const values = {
                    shipstatus: RECORD_STATUS_PACKED
                };
                const logisticsValues = buildLogisticsValues(line);

                Object.keys(logisticsValues).forEach(fieldId => {
                    values[fieldId] = logisticsValues[fieldId];
                });

                record.submitFields({
                    type: record.Type.ITEM_FULFILLMENT,
                    id: line.fulfillmentId,
                    values,
                    options: {
                        enableSourcing: false,
                        ignoreMandatoryFields: true
                    }
                });

                success++;

                if (
                    line.sourceOrderId &&
                    isSalesOrderSource(line.sourceOrderType) &&
                    Object.keys(logisticsValues).length
                ) {
                    const salesOrderId = String(line.sourceOrderId);

                    if (!salesOrderUpdates[salesOrderId]) {
                        salesOrderUpdates[salesOrderId] = {};
                    }

                    Object.keys(logisticsValues).forEach(fieldId => {
                        salesOrderUpdates[salesOrderId][fieldId] = logisticsValues[fieldId];
                    });
                }
            } catch (e) {
                failed++;

                log.error({
                    title: `Failed to pack fulfillment ${line.fulfillmentId}`,
                    details: e
                });
            }
        });

        Object.keys(salesOrderUpdates).forEach(salesOrderId => {
            try {
                record.submitFields({
                    type: record.Type.SALES_ORDER,
                    id: salesOrderId,
                    values: salesOrderUpdates[salesOrderId],
                    options: {
                        enableSourcing: false,
                        ignoreMandatoryFields: true
                    }
                });

                salesOrdersUpdated++;
            } catch (e) {
                salesOrderUpdateFailed++;

                log.error({
                    title: `Failed to update Sales Order ${salesOrderId}`,
                    details: e
                });
            }
        });

        return {
            success,
            failed,
            salesOrdersUpdated,
            salesOrderUpdateFailed
        };
    }

    function buildLogisticsValues(line) {
        const values = {};

        if (line.picker) {
            values[PICKER_FIELD_ID] = line.picker;
        }

        if (line.truck) {
            values[TRUCK_FIELD_ID] = line.truck;
        }

        if (line.tripNumber) {
            values[TRIP_NUMBER_FIELD_ID] = line.tripNumber;
        }

        return values;
    }

    function isSalesOrderSource(sourceOrderType) {
        const normalizedType = String(sourceOrderType || '')
            .replace(/\s+/g, '')
            .toLowerCase();

        return normalizedType === 'salesord' || normalizedType === 'salesorder';
    }

    function updatePackageInfoIfNeeded(fulfillmentId, weight, trackingNumber) {
        if (!weight && !trackingNumber) {
            return;
        }

        const fulfillment = record.load({
            type: record.Type.ITEM_FULFILLMENT,
            id: fulfillmentId,
            isDynamic: false
        });

        const packageSublists = [
            'package',
            'packageups',
            'packagefedex',
            'packageusps'
        ];

        let updated = false;

        for (let i = 0; i < packageSublists.length; i++) {
            const sublistId = packageSublists[i];

            try {
                let lineCount = fulfillment.getLineCount({
                    sublistId
                });

                if (lineCount === 0) {
                    fulfillment.insertLine({
                        sublistId,
                        line: 0
                    });

                    lineCount = 1;
                }

                if (weight) {
                    trySetSublistValue(fulfillment, sublistId, 0, 'packageweight', weight);
                }

                if (trackingNumber) {
                    trySetSublistValue(fulfillment, sublistId, 0, 'packagetrackingnumber', trackingNumber);
                    trySetSublistValue(fulfillment, sublistId, 0, 'trackingnumber', trackingNumber);
                }

                updated = true;
                break;
            } catch (e) {
                // Not every account/carrier uses every package sublist.
            }
        }

        if (updated) {
            fulfillment.save({
                enableSourcing: false,
                ignoreMandatoryFields: true
            });
        }
    }

    function trySetSublistValue(rec, sublistId, line, fieldId, value) {
        try {
            rec.setSublistValue({
                sublistId,
                fieldId,
                line,
                value
            });
        } catch (e) {
            // Some carrier package sublists use slightly different fields.
        }
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
