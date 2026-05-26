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
    'N/log'
], (
    serverWidget,
    search,
    render,
    file,
    config,
    runtime,
    log
) => {

    const FIELD_ACTION = 'custpage_action';
    const FIELD_SELECTED = 'custpage_selected_orders';

    const FIELD_ORDER_NUMBER = 'custpage_order_number';
const FIELD_PICKER = 'custpage_picker';
const FIELD_TRUCK = 'custpage_truck';

const SO_FIELD_PICKER = 'custbody_truck_driver';
const SO_FIELD_TRUCK = 'custbody_truck';

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

    context.response.writeFile({
        file: pdfFile,
        isInline: true
    });
}

    function getPickingTicketData(salesOrderIds) {
        const orderMap = {};

        salesOrderIds.forEach(id => {
            orderMap[String(id)] = {
                id: String(id),
                date: '',
                number: '',
                customer: '',
                shipTo: '',
                shipVia: '',
                location: '',
                lines: []
            };
        });

        const filters = [
            ['type', 'anyof', 'SalesOrd'],
            'AND',
            ['internalid', 'anyof', salesOrderIds],
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

        const columns = [
            search.createColumn({ name: 'internalid' }),
            search.createColumn({ name: 'trandate' }),
            search.createColumn({ name: 'tranid' }),
            search.createColumn({ name: 'entity' }),
            search.createColumn({ name: 'shipaddress' }),
            search.createColumn({ name: 'shipmethod' }),
            search.createColumn({ name: 'location' }),
            search.createColumn({ name: 'line' }),
            search.createColumn({ name: 'item' }),
            search.createColumn({ name: 'salesdescription', join: 'item' }),
            search.createColumn({ name: 'quantity' }),
            search.createColumn({ name: 'quantitycommitted' }),
            search.createColumn({ name: 'quantityshiprecv' }),
            search.createColumn({ name: 'unit' })
        ];

        search.create({
            type: search.Type.SALES_ORDER,
            filters,
            columns
        }).run().each(result => {
            const id = String(result.getValue({ name: 'internalid' }));

            if (!orderMap[id]) {
                return true;
            }

            const order = orderMap[id];

            order.date = result.getValue({ name: 'trandate' }) || '';
            order.number = result.getValue({ name: 'tranid' }) || '';
            order.customer = result.getText({ name: 'entity' }) || '';
            order.shipTo = result.getValue({ name: 'shipaddress' }) || '';
            order.shipVia = result.getText({ name: 'shipmethod' }) || '';
            order.location = result.getText({ name: 'location' }) || '';

            const qty = toNumber(result.getValue({ name: 'quantity' }));
            const qtyCommitted = toNumber(result.getValue({ name: 'quantitycommitted' }));
            const qtyFulfilled = toNumber(result.getValue({ name: 'quantityshiprecv' }));

            const qtyRemaining = Math.max(qty - qtyFulfilled, 0);
            const qtyToPick = qtyCommitted > 0 ? qtyCommitted : qtyRemaining;

            order.lines.push({
                line: result.getValue({ name: 'line' }) || '',
                item: result.getText({ name: 'item' }) || '',
                description: result.getValue({
                    name: 'salesdescription',
                    join: 'item'
                }) || '',
                quantity: qtyRemaining,
                committed: qtyCommitted,
                pickQty: qtyToPick,
                units: result.getText({ name: 'unit' }) || '',
                location: result.getText({ name: 'location' }) || ''
            });

            return true;
        });

        return salesOrderIds
            .map(id => orderMap[String(id)])
            .filter(order => order && order.lines.length);
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
                <td>${xmlEscape(line.item)}</td>
                <td>${xmlEscape(line.description)}</td>
                <td align="center">${xmlEscape(line.units)}</td>
                <td align="right">${xmlEscape(line.pickQty)}</td>
                <td>${xmlEscape(line.location)}</td>
                <td align="right">${xmlEscape(line.committed)}</td>
                <td></td>
            </tr>
        `).join('');

        const logoHtml = logoUrl
            ? `<img src="${xmlEscape(logoUrl)}" style="width:220px;height:auto;" />`
            : `<span style="font-size:28pt;font-weight:bold;">SIMPLEX</span>`;

        return `
            <pdf>
                <head>
                    <style>
                        body {
                            font-family: Helvetica, Arial, sans-serif;
                            font-size: 8pt;
                        }

                        table {
                            width: 100%;
                            border-collapse: collapse;
                        }

                        .title {
                            font-size: 18pt;
                            font-weight: bold;
                        }

                        .small {
                            font-size: 7pt;
                        }

                        .box-title {
                            background-color: #000000;
                            color: #ffffff;
                            font-weight: bold;
                            padding: 3px;
                        }

                        .bordered {
                            border: 0.5px solid #000000;
                        }

                        .line-table th {
                            background-color: #000000;
                            color: #ffffff;
                            font-size: 7pt;
                            padding: 3px;
                            border: 0.5px solid #000000;
                        }

                        .line-table td {
                            font-size: 7pt;
                            padding: 3px;
                            border: 0.5px solid #000000;
                        }
                    </style>
                </head>

                <body size="Letter" margin="0.45in">
                    <table>
                        <tr>
                            <td style="width:60%;">
                                ${logoHtml}
                                <br/>
                                <span class="small">
                                    Simplex Trading Co. Ltd<br/>
                                    St. Michael<br/>
                                    Barbados
                                </span>
                            </td>
                            <td style="width:40%;" align="right">
                                <span class="title">Picking Ticket</span>
                                <br/>
                                <table style="width:170px;margin-left:auto;">
                                    <tr>
                                        <td class="box-title">Date</td>
                                        <td class="box-title">Order #</td>
                                    </tr>
                                    <tr>
                                        <td class="bordered">${xmlEscape(order.date)}</td>
                                        <td class="bordered">${xmlEscape(order.number)}</td>
                                    </tr>
                                </table>
                            </td>
                        </tr>
                    </table>

                    <br/><br/>

                    <table style="width:45%;">
                        <tr>
                            <td class="box-title">Ship To</td>
                        </tr>
                        <tr>
                            <td class="bordered" style="height:55px;">
                                ${xmlEscape(order.customer)}<br/>
                                ${xmlEscape(order.shipTo).replace(/\n/g, '<br/>')}
                            </td>
                        </tr>
                    </table>

                    <br/>

                    <table class="line-table">
                        <thead>
                            <tr>
                                <th style="width:18%;">Item</th>
                                <th style="width:34%;">Description</th>
                                <th style="width:8%;">Units</th>
                                <th style="width:8%;">Qty</th>
                                <th style="width:16%;">Location Detail</th>
                                <th style="width:8%;">Commit</th>
                                <th style="width:8%;">Bin Num</th>
                            </tr>
                        </thead>
                        <tbody>
                            ${lines}
                        </tbody>
                    </table>

                    <br/><br/><br/>

                    <barcode codetype="code128" showtext="true" value="${xmlEscape(order.number)}" />

                </body>
            </pdf>
        `;
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
        }) || '';
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