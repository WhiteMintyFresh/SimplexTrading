/**
 * @NApiVersion 2.1
 * @NScriptType Suitelet
 */
define([
    'N/ui/serverWidget',
    'N/search',
    'N/render',
    'N/file',
    'N/config',
    'N/runtime',
    'N/record',
    'N/log'
], (
    serverWidget,
    search,
    render,
    file,
    config,
    runtime,
    record,
    log
) => {

    const FIELD_ACTION = 'custpage_action';
    const FIELD_SELECTED = 'custpage_selected_orders';

const FIELD_ORDER_NUMBER = 'custpage_order_number';
const FIELD_PICKER = 'custpage_picker';
const FIELD_TRUCK = 'custpage_truck';
const FIELD_ALLOW_REPRINT = 'custpage_allow_reprint';

const SO_FIELD_PICKER = 'custbody_truck_driver';
const SO_FIELD_TRUCK = 'custbody_truck';

const PICKER_LIST_ID = 'customlist_truck_driver_list';
const TRUCK_LIST_ID = 'customlist_truck_fulfillment';

const customListTextCache = {};

// Create this Sales Order body checkbox.
const DEFAULT_PRINTED_FIELD_ID = 'custbody_picking_ticket_printed';

    /*
     * Optional script parameters:
     *
     * custscript_pt_logo_file_id
     * custscript_pt_printed_field_id
     *
     * custscript_pt_logo_file_id:
     * Internal ID of your Simplex logo image in the File Cabinet.
     *
     * custscript_pt_printed_field_id:
     * Optional Sales Order body checkbox field used to track whether the
     * picking ticket was already printed.
     * Example: custbody_picking_ticket_printed
     */
    const PARAM_LOGO_FILE_ID = 'custscript_pt_logo_file_id';
    const PARAM_PRINTED_FIELD_ID = 'custscript_pt_printed_field_id';

    function onRequest(context) {
        try {
            if (context.request.method === 'POST') {
                const action = context.request.parameters[FIELD_ACTION];

                if (action === 'print') {
                    printPickingTickets(context);
                    return;
                }
            }

            renderPickingTicketPage(context);

        } catch (e) {
            log.error({
                title: 'Print Picking Tickets Suitelet Error',
                details: e
            });

            renderPickingTicketPage(context, 'Error: ' + e.message);
        }
    }

    function renderPickingTicketPage(context, message) {
        const params = context.request.parameters || {};

        const form = serverWidget.createForm({
            title: 'Print Picking Tickets'
        });

        form.clientScriptModulePath = './cs_print_picking_tickets.js';

        form.addButton({
            id: 'custpage_print_top',
            label: 'Print',
            functionName: 'printPickingTickets'
        });

        form.addButton({
            id: 'custpage_mark_all_top',
            label: 'Mark All',
            functionName: 'markAllPickingTickets'
        });

        form.addButton({
            id: 'custpage_unmark_all_top',
            label: 'Unmark All',
            functionName: 'unmarkAllPickingTickets'
        });

        const actionField = form.addField({
            id: FIELD_ACTION,
            label: 'Action',
            type: serverWidget.FieldType.TEXT
        });

        actionField.updateDisplayType({
            displayType: serverWidget.FieldDisplayType.HIDDEN
        });

        const selectedField = form.addField({
            id: FIELD_SELECTED,
            label: 'Selected Orders',
            type: serverWidget.FieldType.LONGTEXT
        });

        selectedField.updateDisplayType({
            displayType: serverWidget.FieldDisplayType.HIDDEN
        });

        if (message) {
            const msg = form.addField({
                id: 'custpage_message',
                label: 'Message',
                type: serverWidget.FieldType.INLINEHTML
            });

            msg.defaultValue = `
                <div style="padding:10px;margin-bottom:12px;border:1px solid #c7d5e0;background:#f4f8fb;">
                    ${escapeHtml(message)}
                </div>
            `;
        }

        addFilters(form, params);
        addResultsTable(form, params);

        context.response.writePage(form);
    }

    function addFilters(form, params) {
    const filterGroup = form.addFieldGroup({
        id: 'custpage_filter_group',
        label: 'Filters'
    });

    const orderNumber = form.addField({
        id: FIELD_ORDER_NUMBER,
        label: 'Select Order Number',
        type: serverWidget.FieldType.TEXT,
        container: 'custpage_filter_group'
    });

    orderNumber.defaultValue = params[FIELD_ORDER_NUMBER] || '';

    const pickerField = form.addField({
        id: FIELD_PICKER,
        label: 'Picker',
        type: serverWidget.FieldType.SELECT,
        container: 'custpage_filter_group'
    });

    pickerField.addSelectOption({
        value: '',
        text: ''
    });

    addCustomBodyFieldOptionsFromSalesOrders({
        selectField: pickerField,
        fieldId: SO_FIELD_PICKER
    });

    if (params[FIELD_PICKER]) {
        pickerField.defaultValue = params[FIELD_PICKER];
    }

    const truckField = form.addField({
        id: FIELD_TRUCK,
        label: 'Truck',
        type: serverWidget.FieldType.SELECT,
        container: 'custpage_filter_group'
    });

    truckField.addSelectOption({
        value: '',
        text: ''
    });

    addCustomBodyFieldOptionsFromSalesOrders({
        selectField: truckField,
        fieldId: SO_FIELD_TRUCK
    });

    if (params[FIELD_TRUCK]) {
        truckField.defaultValue = params[FIELD_TRUCK];
    }

    const allowReprint = form.addField({
        id: FIELD_ALLOW_REPRINT,
        label: 'Allow Reprinting',
        type: serverWidget.FieldType.CHECKBOX,
        container: 'custpage_filter_group'
    });

    allowReprint.defaultValue = params[FIELD_ALLOW_REPRINT] === 'T' ? 'T' : 'F';

    form.addButton({
        id: 'custpage_refresh',
        label: 'Refresh',
        functionName: 'refreshPickingTickets'
    });
}

function addCustomBodyFieldOptionsFromSalesOrders(options) {
    const selectField = options.selectField;
    const fieldId = options.fieldId;

    const added = {};

    try {
        search.create({
            type: search.Type.SALES_ORDER,
            filters: [
                ['type', 'anyof', 'SalesOrd'],
                'AND',
                ['mainline', 'is', 'T'],
                'AND',
                [fieldId, 'noneof', '@NONE@']
            ],
            columns: [
                search.createColumn({
                    name: fieldId,
                    summary: search.Summary.GROUP,
                    sort: search.Sort.ASC
                })
            ]
        }).run().each(result => {
            const value = result.getValue({
                name: fieldId,
                summary: search.Summary.GROUP
            });

            const text = result.getText({
                name: fieldId,
                summary: search.Summary.GROUP
            });

            if (value && !added[value]) {
                selectField.addSelectOption({
                    value: String(value),
                    text: text || String(value)
                });

                added[value] = true;
            }

            return true;
        });
    } catch (e) {
        log.error({
            title: 'Unable to load filter options for ' + fieldId,
            details: e
        });
    }
}

    function addResultsTable(form, params) {
        const orders = searchEligibleSalesOrders(params);

        const htmlField = form.addField({
            id: 'custpage_results_html',
            label: 'Results',
            type: serverWidget.FieldType.INLINEHTML
        });

        htmlField.updateLayoutType({
            layoutType: serverWidget.FieldLayoutType.OUTSIDEBELOW
        });

        htmlField.defaultValue = buildResultsHtml(orders);
    }

    function searchEligibleSalesOrders(params) {
    const orderNumber = params[FIELD_ORDER_NUMBER];
    const pickerId = params[FIELD_PICKER];
    const truckId = params[FIELD_TRUCK];
    const allowReprint = params[FIELD_ALLOW_REPRINT] === 'T';
    const printedFieldId = getPrintedFieldId();

    const filters = [
        ['type', 'anyof', 'SalesOrd'],
        'AND',
        ['mainline', 'is', 'F'],
        'AND',
        ['taxline', 'is', 'F'],
        'AND',
        ['shipping', 'is', 'F'],
        'AND',
        ['cogs', 'is', 'F'],
        'AND',
        ['closed', 'is', 'F'],
        'AND',
        ['item.type', 'noneof', ['Description', 'Discount', 'Markup', 'Subtotal']]
    ];

    if (orderNumber) {
        filters.push('AND', ['tranid', 'contains', orderNumber]);
    }

    if (pickerId) {
        filters.push('AND', [SO_FIELD_PICKER, 'anyof', pickerId]);
    }

    if (truckId) {
        filters.push('AND', [SO_FIELD_TRUCK, 'anyof', truckId]);
    }

    if (printedFieldId && !allowReprint) {
        filters.push('AND', [printedFieldId, 'is', 'F']);
    }

    const columns = [
        search.createColumn({
            name: 'trandate',
            summary: search.Summary.GROUP,
            sort: search.Sort.DESC
        }),
        search.createColumn({
            name: 'tranid',
            summary: search.Summary.GROUP
        }),
        search.createColumn({
            name: 'internalid',
            summary: search.Summary.GROUP
        }),
        search.createColumn({
            name: 'entity',
            summary: search.Summary.GROUP
        }),
        search.createColumn({
            name: 'shipaddress',
            summary: search.Summary.GROUP
        }),
        search.createColumn({
            name: 'shipmethod',
            summary: search.Summary.GROUP
        }),
        search.createColumn({
            name: SO_FIELD_PICKER,
            summary: search.Summary.GROUP
        }),
        search.createColumn({
            name: SO_FIELD_TRUCK,
            summary: search.Summary.GROUP
        })
    ];

    const results = [];

    search.create({
        type: search.Type.SALES_ORDER,
        filters,
        columns
    }).run().each(result => {
        results.push({
            id: result.getValue({
                name: 'internalid',
                summary: search.Summary.GROUP
            }),
            date: result.getValue({
                name: 'trandate',
                summary: search.Summary.GROUP
            }),
            number: result.getValue({
                name: 'tranid',
                summary: search.Summary.GROUP
            }),
            customer: result.getText({
                name: 'entity',
                summary: search.Summary.GROUP
            }) || '',
            shipTo: result.getValue({
                name: 'shipaddress',
                summary: search.Summary.GROUP
            }) || '',
            shipVia: result.getText({
                name: 'shipmethod',
                summary: search.Summary.GROUP
            }) || '',
            picker: result.getText({
                name: SO_FIELD_PICKER,
                summary: search.Summary.GROUP
            }) || '',
            truck: result.getText({
                name: SO_FIELD_TRUCK,
                summary: search.Summary.GROUP
            }) || ''
        });

        return results.length < 500;
    });

    return results;
}

    function buildResultsHtml(orders) {
        let rows = '';

        if (!orders.length) {
            rows = `
                <tr>
                    <td colspan="10" style="padding:12px;text-align:center;">
                        No records to show.
                    </td>
                </tr>
            `;
        } else {
            orders.forEach(order => {
                rows += `
    <tr>
        <td class="center">
            <input type="checkbox"
                   class="pt-check"
                   data-id="${escapeHtml(order.id)}"
                   data-number="${escapeHtml(order.number)}">
        </td>
        <td>${escapeHtml(order.date)}</td>
        <td>Sales Order</td>
        <td>${escapeHtml(order.number)}</td>
        <td>${escapeHtml(order.id)}</td>
        <td>${escapeHtml(order.customer)}</td>
        <td>${escapeHtml(order.shipTo).replace(/\n/g, '<br>')}</td>
        <td>${escapeHtml(order.shipVia)}</td>
        <td>${escapeHtml(order.picker)}</td>
        <td>${escapeHtml(order.truck)}</td>
    </tr>
`;
            });
        }

        return `
            <style>
                .pt-wrapper {
                    margin-top: 12px;
                    border: 1px solid #d8d8d8;
                    width: 100%;
                    overflow-x: auto;
                }

                .pt-table {
                    width: 100%;
                    border-collapse: collapse;
                    font-size: 12px;
                    font-family: Arial, Helvetica, sans-serif;
                }

                .pt-table th {
                    background: #f4f4f4;
                    border-bottom: 1px solid #d0d0d0;
                    padding: 5px;
                    text-align: left;
                    font-weight: 600;
                    white-space: nowrap;
                }

                .pt-table td {
                    border-top: 1px solid #e6e6e6;
                    padding: 5px;
                    vertical-align: top;
                }

                .pt-table tr:hover td {
                    background: #eef6fb;
                }

                .center {
                    text-align: center;
                }

                .pt-bottom-buttons {
                    margin-top: 10px;
                }

                .pt-bottom-buttons button {
                    margin-right: 8px;
                    padding: 5px 12px;
                }
            </style>

            <div class="pt-wrapper">
                <table class="pt-table">
                    <thead>
    <tr>
        <th>Print</th>
        <th>Date</th>
        <th>Type</th>
        <th>Number</th>
        <th>ID</th>
        <th>Customer</th>
        <th>Ship To</th>
        <th>Ship Via</th>
        <th>Picker</th>
        <th>Truck</th>
    </tr>
</thead>
                    <tbody>
                        ${rows}
                    </tbody>
                </table>
            </div>

            <div class="pt-bottom-buttons">
                <button type="button" onclick="printPickingTickets()">Print</button>
                <button type="button" onclick="markAllPickingTickets()">Mark All</button>
                <button type="button" onclick="unmarkAllPickingTickets()">Unmark All</button>
            </div>
        `;
    }

    function printPickingTickets(context) {
    const selectedJson = context.request.parameters[FIELD_SELECTED] || '[]';

    let selectedOrders;

    try {
        selectedOrders = JSON.parse(selectedJson);
    } catch (e) {
        throw new Error('Unable to read selected orders.');
    }

    const salesOrderIds = selectedOrders
        .map(order => order.id)
        .filter(id => !!id);

    if (!salesOrderIds.length) {
        throw new Error('Please select at least one order to print.');
    }

    const orders = getPickingTicketData(salesOrderIds);

    if (!orders.length) {
        throw new Error('No printable picking ticket data was found for the selected order(s).');
    }

    const logoUrl = getLogoUrl();
    const xml = buildPdfSetXml(orders, logoUrl);

    const pdfFile = render.xmlToPdf({
        xmlString: xml
    });

    pdfFile.name = 'Picking_Tickets.pdf';

    markSalesOrdersAsPrinted(salesOrderIds);

    context.response.writeFile({
        file: pdfFile,
        isInline: true
    });
}

function markSalesOrdersAsPrinted(salesOrderIds) {
    const printedFieldId = getPrintedFieldId();

    if (!printedFieldId) {
        return;
    }

    salesOrderIds.forEach(id => {
        try {
            record.submitFields({
                type: record.Type.SALES_ORDER,
                id: id,
                values: {
                    [printedFieldId]: true
                },
                options: {
                    enableSourcing: false,
                    ignoreMandatoryFields: true
                }
            });
        } catch (e) {
            log.error({
                title: 'Unable to mark Sales Order as printed: ' + id,
                details: e
            });
        }
    });
}

    function getPickingTicketData(salesOrderIds) {
    return salesOrderIds
        .map(id => buildPickingTicketFromSalesOrder(id))
        .filter(order => order && order.lines && order.lines.length);
}

function buildPickingTicketFromSalesOrder(salesOrderId) {
    const soRec = record.load({
        type: record.Type.SALES_ORDER,
        id: salesOrderId,
        isDynamic: false
    });

    const lookup = search.lookupFields({
    type: search.Type.SALES_ORDER,
    id: salesOrderId,
    columns: [
        SO_FIELD_PICKER,
        SO_FIELD_TRUCK
    ]
});

const order = {
    id: String(salesOrderId),
    date: soRec.getText({ fieldId: 'trandate' }) || soRec.getValue({ fieldId: 'trandate' }) || '',
    number: soRec.getValue({ fieldId: 'tranid' }) || '',
    customer: soRec.getText({ fieldId: 'entity' }) || '',
    shipTo: cleanPdfAddress(soRec.getValue({ fieldId: 'shipaddress' }) || ''),
    shipVia: soRec.getText({ fieldId: 'shipmethod' }) || '',
    location: soRec.getText({ fieldId: 'location' }) || '',
    picker: getLookupSelectText(lookup, SO_FIELD_PICKER),
    truck: getLookupSelectText(lookup, SO_FIELD_TRUCK),
    lines: []
};

    const lineCount = soRec.getLineCount({
        sublistId: 'item'
    });

    for (let i = 0; i < lineCount; i++) {
        const isClosed = soRec.getSublistValue({
            sublistId: 'item',
            fieldId: 'isclosed',
            line: i
        });

        if (isClosed === true || isClosed === 'T') {
            continue;
        }

        const itemType = soRec.getSublistValue({
            sublistId: 'item',
            fieldId: 'itemtype',
            line: i
        });

        if (['Description', 'Discount', 'Markup', 'Subtotal', 'Group', 'EndGroup'].indexOf(itemType) !== -1) {
            continue;
        }

        const code = soRec.getSublistText({
            sublistId: 'item',
            fieldId: 'item',
            line: i
        }) || '';

        const description =
            soRec.getSublistValue({
                sublistId: 'item',
                fieldId: 'description',
                line: i
            }) || '';

        const quantity = toNumber(soRec.getSublistValue({
            sublistId: 'item',
            fieldId: 'quantity',
            line: i
        }));

        const quantityFulfilled = toNumber(soRec.getSublistValue({
            sublistId: 'item',
            fieldId: 'quantityfulfilled',
            line: i
        }));

        const quantityCommitted = toNumber(soRec.getSublistValue({
            sublistId: 'item',
            fieldId: 'quantitycommitted',
            line: i
        }));

        const quantityAvailable = soRec.getSublistValue({
            sublistId: 'item',
            fieldId: 'quantityavailable',
            line: i
        });

        const units = soRec.getSublistText({
            sublistId: 'item',
            fieldId: 'units',
            line: i
        }) || '';

        const qtyRemaining = Math.max(quantity - quantityFulfilled, 0);

        /*
         * Use Sales Order display quantity, not base-unit quantity.
         * This matches the XML/UI value, e.g. 200 CS instead of 4800 base units.
         */
        const qtyToPrint = quantityCommitted > 0 ? quantityCommitted : qtyRemaining;

        order.lines.push({
            code: code,
            description: description,
            quantity: qtyRemaining,
            committed: quantityCommitted,
            pickQty: qtyToPrint,
            units: units,
            onHand: quantityAvailable || '',
            location: soRec.getSublistText({
                sublistId: 'item',
                fieldId: 'location',
                line: i
            }) || order.location
        });
    }

    log.debug({
    title: 'Picking Ticket Assignment Fields',
    details: {
        salesOrderId: salesOrderId,
        pickerRaw: soRec.getValue({ fieldId: SO_FIELD_PICKER }),
        truckRaw: soRec.getValue({ fieldId: SO_FIELD_TRUCK }),
        pickerText: order.picker,
        truckText: order.truck,
        lookup: lookup
    }
});

    return order;
}

function getCustomListText(listScriptId, internalId) {
    if (!internalId) {
        return '';
    }

    const cacheKey = listScriptId + ':' + internalId;

    if (customListTextCache[cacheKey]) {
        return customListTextCache[cacheKey];
    }

    try {
        const results = search.create({
            type: listScriptId,
            filters: [
                ['internalid', 'anyof', internalId]
            ],
            columns: [
                search.createColumn({ name: 'name' })
            ]
        }).run().getRange({
            start: 0,
            end: 1
        });

        if (results && results.length) {
            const name = results[0].getValue({ name: 'name' }) || '';
            customListTextCache[cacheKey] = name;
            return name;
        }
    } catch (e) {
        log.error({
            title: 'Unable to resolve custom list value',
            details: {
                listScriptId: listScriptId,
                internalId: internalId,
                error: e
            }
        });
    }

    return String(internalId);
}

function getLookupSelectText(lookupResult, fieldId) {
    const value = lookupResult[fieldId];

    if (!value) {
        return '';
    }

    if (Array.isArray(value) && value.length) {
        return value[0].text || value[0].value || '';
    }

    if (typeof value === 'object') {
        return value.text || value.value || '';
    }

    return String(value);
}

function cleanPdfAddress(value) {
    if (!value) {
        return '';
    }

    return String(value)
        .replace(/<br\s*\/?>/gi, '\n')
        .replace(/&nbsp;/gi, ' ')
        .replace(/\r/g, '')
        .trim();
}

    function buildPdfSetXml(orders, logoUrl) {
        let pdfs = '';

        orders.forEach(order => {
            pdfs += buildSinglePickingTicketPdf(order, logoUrl);
        });

        return `<?xml version="1.0"?>
            <!DOCTYPE pdf PUBLIC "-//big.faceless.org//report" "report-1.1.dtd">
            <pdfset>
                ${pdfs}
            </pdfset>`;
    }

    function buildSinglePickingTicketPdf(order, logoUrl) {
    const lines = order.lines.map(line => `
        <tr>
            <td class="line-cell code-cell">${xmlEscape(line.code)}</td>
            <td class="line-cell desc-cell">${xmlEscape(line.description)}</td>
            <td class="line-cell qty-cell">${formatQty(line.pickQty)}</td>
            <td class="line-cell unit-cell">${xmlEscape(line.units)}</td>
            <td class="line-cell-last onhand-cell">${formatQty(line.onHand)}</td>
        </tr>
    `).join('');

    const fillerRows = buildBlankRows(Math.max(9 - order.lines.length, 0));

    const logoHtml = logoUrl
    ? `<img src="${xmlEscape(logoUrl)}" style="width:125px;height:70px;object-fit:contain;" />`
    : `<span style="font-size:22pt;font-weight:bold;color:#174f7a;">SIMPLEX</span><br/>
       <span style="font-size:7pt;letter-spacing:1.5px;color:#666666;">TRADING CO. LTD.</span>`;

    return `
        <pdf>
            <head>
                <style>
                    body {
                        font-family: Helvetica, Arial, sans-serif;
                        font-size: 9pt;
                        color: #222222;
                    }

                    table {
                        width: 100%;
                        border-collapse: collapse;
                    }

                    .date-order td {
                        border: 0.75px solid #222222;
                        padding: 5px;
                    }

                    .date-order-label {
                        font-size: 8pt;
                        font-weight: bold;
                    }

                    .date-order-value {
                        font-size: 9pt;
                    }

                    .title-single {
    font-size: 20pt;
    font-weight: bold;
    letter-spacing: 1px;
    text-align: center;
    white-space: nowrap;
}

                    .ship-box {
                        border: 0.75px solid #222222;
                        padding: 7px;
                        height: 95px;
                        vertical-align: top;
                    }

                    .label {
                        font-size: 10pt;
                        font-weight: bold;
                    }

                    .address {
                        font-size: 9pt;
                        line-height: 12pt;
                    }

                    .assignment-title {
                        font-size: 10pt;
                        font-weight: bold;
                        text-align: center;
                        padding-bottom: 4px;
                    }

                    .assignment-value {
                        font-size: 10pt;
                        text-align: center;
                        border: 0.75px solid #222222;
                        padding: 6px;
                        height: 20px;
                    }

                    .line-table {
                        width: 100%;
                        border: 0.75px solid #222222;
                    }

                    .line-table th {
                        border-right: 0.75px solid #222222;
                        border-bottom: 0.75px solid #222222;
                        padding: 6px;
                        font-size: 10pt;
                        font-weight: bold;
                        text-align: left;
                    }

                    .line-table th.last-header {
                        border-right: none;
                    }

.line-cell {
    border-right: 0.75px solid #222222;
    padding: 5px;
    height: 20px;
    vertical-align: top;
    font-size: 9pt;
}

.line-cell-last {
    padding: 5px;
    height: 20px;
    vertical-align: top;
    font-size: 9pt;
}

.blank-cell {
    border-right: 0.75px solid #222222;
    padding: 5px;
    height: 20px;
}

.blank-cell-last {
    padding: 5px;
    height: 20px;
}

                    .code-cell {
                        width: 14%;
                    }

                    .desc-cell {
                        width: 39%;
                    }

                    .qty-cell {
                        width: 10%;
                        text-align: right;
                    }

                    .unit-cell {
                        width: 12%;
                        text-align: center;
                    }

                    .onhand-cell {
                        width: 25%;
                        text-align: right;
                    }
                </style>
            </head>

            <body size="Letter" margin="0.42in">

                <table>
                    <tr>
                        <td style="width:26%; vertical-align:top;">
                            ${logoHtml}
                        </td>

                        <td style="width:8%;"></td>

                        <td style="width:36%; vertical-align:middle; text-align:center;">
    <span class="title-single">PICKING TICKET</span>
</td>

                        <td style="width:6%;"></td>

                        <td style="width:22%; vertical-align:top;">
                            <table class="date-order">
                                <tr>
                                    <td class="date-order-label">DATE</td>
                                    <td class="date-order-label">ORDER #</td>
                                </tr>
                                <tr>
                                    <td class="date-order-value">${xmlEscape(order.date)}</td>
                                    <td class="date-order-value">${xmlEscape(order.number)}</td>
                                </tr>
                            </table>
                        </td>
                    </tr>
                </table>

                <br/>

                <table>
                    <tr>
                        <td style="width:42%;" class="ship-box">
                            <span class="label">SHIP TO:</span><br/>
                            <span class="address">
                                ${xmlEscape(order.customer)}<br/>
                                ${xmlEscape(order.shipTo).replace(/\n/g, '<br/>')}
                            </span>
                        </td>

                        <td style="width:16%;"></td>

                        <td style="width:17%; vertical-align:bottom;">
                            <table>
                                <tr>
                                    <td class="assignment-title">PICKER</td>
                                </tr>
                                <tr>
                                    <td class="assignment-value">${xmlEscape(order.picker)}</td>
                                </tr>
                            </table>
                        </td>

                        <td style="width:8%;"></td>

                        <td style="width:17%; vertical-align:bottom;">
                            <table>
                                <tr>
                                    <td class="assignment-title">TRUCK</td>
                                </tr>
                                <tr>
                                    <td class="assignment-value">${xmlEscape(order.truck)}</td>
                                </tr>
                            </table>
                        </td>
                    </tr>
                </table>

                <br/>

                <table class="line-table">
                    <thead>
                        <tr>
                            <th style="width:14%;">CODE</th>
                            <th style="width:39%;">DESCRIPTION</th>
                            <th style="width:10%; text-align:right;">QTY</th>
                            <th style="width:12%; text-align:center;">UNIT</th>
                            <th class="last-header" style="width:25%; text-align:right;">ON HAND</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${lines}
                        ${fillerRows}
                    </tbody>
                </table>

                <br/><br/>

                <table style="width:150px;">
                    <tr>
                        <td style="text-align:center;">
                            <barcode codetype="code128" showtext="true" value="${xmlEscape(order.number)}" />
                        </td>
                    </tr>
                </table>

            </body>
        </pdf>
    `;
}

function buildBlankRows(count) {
    let rows = '';

    for (let i = 0; i < count; i++) {
        rows += `
            <tr>
                <td class="blank-cell">&nbsp;</td>
                <td class="blank-cell">&nbsp;</td>
                <td class="blank-cell">&nbsp;</td>
                <td class="blank-cell">&nbsp;</td>
                <td class="blank-cell-last">&nbsp;</td>
            </tr>
        `;
    }

    return rows;
}



    function getLogoUrl() {
        const script = runtime.getCurrentScript();
        const logoFileId = script.getParameter({
            name: PARAM_LOGO_FILE_ID
        });

        if (!logoFileId) {
            return '';
        }

        try {
            const logoFile = file.load({
                id: logoFileId
            });

            return logoFile.url;
        } catch (e) {
            log.error({
                title: 'Unable to load logo file',
                details: e
            });

            return '';
        }
    }

    function getPrintedFieldId() {
    return runtime.getCurrentScript().getParameter({
        name: PARAM_PRINTED_FIELD_ID
    }) || DEFAULT_PRINTED_FIELD_ID;
}

function formatQty(value) {
    const numberValue = parseFloat(value);

    if (isNaN(numberValue)) {
        return value || '';
    }

    if (numberValue % 1 === 0) {
        return String(parseInt(numberValue, 10));
    }

    return String(numberValue);
}

    function toNumber(value) {
        const numberValue = parseFloat(value);
        return isNaN(numberValue) ? 0 : numberValue;
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

    function xmlEscape(value) {
        if (value === null || value === undefined) {
            return '';
        }

        return String(value)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&apos;');
    }

    return {
        onRequest
    };
});