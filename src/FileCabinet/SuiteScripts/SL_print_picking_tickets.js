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
const FIELD_TRIP = 'custpage_trip_number';
const FIELD_LOCATION = 'custpage_location';
const FIELD_SALES_REP = 'custpage_sales_rep';
const FIELD_TRANSACTION_TYPE = 'custpage_transaction_type';
const FIELD_ALLOW_REPRINT = 'custpage_allow_reprint';

const SO_FIELD_PICKER = 'custbody_simplex_picked_by';
const SO_FIELD_TRUCK = 'custbody_truck';
const SO_FIELD_TRIP = 'custbody_simplex_trip_number';
const SO_FIELD_SALES_REP = 'custbody_simplex_sale_rep';
const SO_FIELD_PICKING_TICKET_MEMO = 'custbody_picking_ticket_memo';

const PICKER_LIST_ID = 'customlist_spx_pickers';
const TRUCK_LIST_ID = 'customlist_truck_fulfillment';

const customListTextCache = {};
const vendorItemCodeCache = {};

/*
 * Governance protection for the synchronous print request.
 *
 * Every selected transaction still requires one transaction record.load()
 * and one transaction record.submitFields(), which cost 10 units each.
 * The reserve covers the batched searches, logo load, PDF rendering, and a
 * safety margin so the Suitelet can stop cleanly instead of exhausting all
 * remaining usage.
 */
const PRINT_FIXED_USAGE_RESERVE = 200;
const PRINT_USAGE_PER_TRANSACTION = 20;
const PRINT_FINALIZATION_BUFFER = 30;
const MAX_SALES_ORDER_CANDIDATES = 4000;
const SEARCH_FILTER_ID_CHUNK_SIZE = 900;

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
            const errorMessage = getErrorMessage(e);

            log.error({
                title: 'Print Picking Tickets Suitelet Error',
                details: serializeError(e)
            });

            /*
             * Do not run all of the page searches after governance has been
             * exhausted (or when the finalization guard detects that it is
             * close). A second governance failure is what commonly produces
             * the unhelpful ScriptNullObjectAdapter system entry.
             */
            if (
                isUsageLimitError(e) ||
                (e && e.name === 'PT_INSUFFICIENT_USAGE') ||
                (e && e.name === 'PT_FULFILLMENT_LOOKUP_FAILED')
            ) {
                writeLightweightErrorPage(context, errorMessage);
                return;
            }

            renderPickingTicketPage(context, 'Error: ' + errorMessage);
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
        addFulfillmentRuleNotice(form);
        addResultsTable(form, params);

        context.response.writePage(form);
    }

    function addFulfillmentRuleNotice(form) {
        const notice = form.addField({
            id: 'custpage_fulfillment_rule_notice',
            label: 'Picking Ticket Rule',
            type: serverWidget.FieldType.INLINEHTML
        });

        notice.defaultValue = `
            <div style="padding:9px 12px;margin-top:10px;border:1px solid #b8d6b8;background:#f2fbf2;color:#234d23;">
                <strong>Sales Order requirement:</strong>
                Only Sales Orders with at least one active Item Fulfillment
                are available for picking-ticket printing.
            </div>
        `;
    }

    function addFilters(form, params) {
    form.addFieldGroup({
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

    const transactionTypeField = form.addField({
        id: FIELD_TRANSACTION_TYPE,
        label: 'Transaction Type',
        type: serverWidget.FieldType.SELECT,
        container: 'custpage_filter_group'
    });

    transactionTypeField.addSelectOption({
        value: '',
        text: 'All'
    });

    transactionTypeField.addSelectOption({
        value: 'salesorder',
        text: 'Sales Order'
    });

    transactionTypeField.addSelectOption({
        value: 'transferorder',
        text: 'Transfer Order'
    });

    if (params[FIELD_TRANSACTION_TYPE]) {
        transactionTypeField.defaultValue =
            params[FIELD_TRANSACTION_TYPE];
    }

    const locationField = form.addField({
        id: FIELD_LOCATION,
        label: 'Location',
        type: serverWidget.FieldType.SELECT,
        source: 'location',
        container: 'custpage_filter_group'
    });
    if (params[FIELD_LOCATION]) {
        locationField.defaultValue = params[FIELD_LOCATION];
    }

    const salesRepField = form.addField({
        id: FIELD_SALES_REP,
        label: 'Sales Rep',
        type: serverWidget.FieldType.SELECT,
        container: 'custpage_filter_group'
    });
    salesRepField.addSelectOption({ value: '', text: '' });
    addCustomBodyFieldOptionsFromSalesOrders({
        selectField: salesRepField,
        fieldId: SO_FIELD_SALES_REP
    });
    if (params[FIELD_SALES_REP]) {
        salesRepField.defaultValue = params[FIELD_SALES_REP];
    }

    const pickerField = form.addField({
        id: FIELD_PICKER,
        label: 'Picker',
        type: serverWidget.FieldType.SELECT,
        container: 'custpage_filter_group'
    });
    pickerField.addSelectOption({ value: '', text: '' });
    addCustomBodyFieldOptionsFromSalesAndTransferOrders({
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
    truckField.addSelectOption({ value: '', text: '' });
    addCustomBodyFieldOptionsFromSalesAndTransferOrders({
        selectField: truckField,
        fieldId: SO_FIELD_TRUCK
    });
    if (params[FIELD_TRUCK]) {
        truckField.defaultValue = params[FIELD_TRUCK];
    }

    const tripField = form.addField({
        id: FIELD_TRIP,
        label: 'Trip #',
        type: serverWidget.FieldType.SELECT,
        container: 'custpage_filter_group'
    });
    tripField.addSelectOption({ value: '', text: '' });
    addTripNumberOptions(tripField);
    if (params[FIELD_TRIP]) {
        tripField.defaultValue = params[FIELD_TRIP];
    }

    const allowReprint = form.addField({
        id: FIELD_ALLOW_REPRINT,
        label: 'Allow Reprinting',
        type: serverWidget.FieldType.CHECKBOX,
        container: 'custpage_filter_group'
    });
    allowReprint.defaultValue =
        params[FIELD_ALLOW_REPRINT] === 'T' ? 'T' : 'F';

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

function addCustomBodyFieldOptionsFromSalesAndTransferOrders(options) {
    const selectField = options.selectField;
    const fieldId = options.fieldId;
    const added = {};

    const sources = [
        {
            type: search.Type.SALES_ORDER,
            typeFilter: 'SalesOrd'
        },
        {
            type: search.Type.TRANSFER_ORDER,
            typeFilter: 'TrnfrOrd'
        }
    ];

    sources.forEach(source => {
        try {
            search.create({
                type: source.type,
                filters: [
                    ['type', 'anyof', source.typeFilter],
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

                if (value && !added[String(value)]) {
                    selectField.addSelectOption({
                        value: String(value),
                        text: text || String(value)
                    });
                    added[String(value)] = true;
                }

                return true;
            });
        } catch (e) {
            log.error({
                title: 'Unable to load filter options for ' +
                    fieldId + ' on ' + source.typeFilter,
                details: e
            });
        }
    });
}


function addTripNumberOptions(selectField) {
    const added = {};

    const sources = [
        {
            type: search.Type.SALES_ORDER,
            typeFilter: 'SalesOrd'
        },
        {
            type: search.Type.TRANSFER_ORDER,
            typeFilter: 'TrnfrOrd'
        }
    ];

    sources.forEach(source => {
        try {
            search.create({
                type: source.type,
                filters: [
                    ['type', 'anyof', source.typeFilter],
                    'AND',
                    ['mainline', 'is', 'T'],
                    'AND',
                    [SO_FIELD_TRIP, 'isnotempty', '']
                ],
                columns: [
                    search.createColumn({
                        name: SO_FIELD_TRIP,
                        summary: search.Summary.GROUP,
                        sort: search.Sort.ASC
                    })
                ]
            }).run().each(result => {
                const value = result.getValue({
                    name: SO_FIELD_TRIP,
                    summary: search.Summary.GROUP
                });

                if (
                    value !== null &&
                    value !== '' &&
                    !added[String(value)]
                ) {
                    selectField.addSelectOption({
                        value: String(value),
                        text: String(value)
                    });
                    added[String(value)] = true;
                }

                return true;
            });
        } catch (e) {
            log.error({
                title: 'Unable to load Trip # options for ' +
                    source.typeFilter,
                details: e
            });
        }
    });
}


    function addResultsTable(form, params) {
        const orders = searchEligibleTransactions(params);

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

    function searchEligibleTransactions(params) {
    const transactionType =
        params[FIELD_TRANSACTION_TYPE] || '';

    let salesOrders = [];
    let transferOrders = [];

    if (
        !transactionType ||
        transactionType === 'salesorder'
    ) {
        salesOrders = searchEligibleSalesOrders(params);
    }

    if (
        !transactionType ||
        transactionType === 'transferorder'
    ) {
        transferOrders = searchEligibleTransferOrders(params);
    }

    return salesOrders
        .concat(transferOrders)
        .sort((a, b) => {
            const aNumber = String(a.number || '');
            const bNumber = String(b.number || '');
            return bNumber.localeCompare(aNumber, undefined, {
                numeric: true,
                sensitivity: 'base'
            });
        })
        .slice(0, 500);
}

function searchEligibleSalesOrders(params) {
    const orderNumber = params[FIELD_ORDER_NUMBER];
    const locationId = params[FIELD_LOCATION];
    const salesRepId = params[FIELD_SALES_REP];
    const pickerId = params[FIELD_PICKER];
    const truckId = params[FIELD_TRUCK];
    const tripId = params[FIELD_TRIP];
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
        ['status', 'noneof', [
            'SalesOrd:C',
            'SalesOrd:G',
            'SalesOrd:H'
        ]],
        'AND',
        ['item.type', 'noneof', [
            'Description',
            'Discount',
            'Markup',
            'Subtotal'
        ]]
    ];

    if (orderNumber) {
        filters.push('AND', ['tranid', 'contains', orderNumber]);
    }

    if (locationId) {
        filters.push('AND', ['location', 'anyof', locationId]);
    }

    if (salesRepId) {
        filters.push('AND', [
            SO_FIELD_SALES_REP,
            'anyof',
            salesRepId
        ]);
    }

    if (pickerId) {
        filters.push('AND', [
            SO_FIELD_PICKER,
            'anyof',
            pickerId
        ]);
    }

    if (truckId) {
        filters.push('AND', [
            SO_FIELD_TRUCK,
            'anyof',
            truckId
        ]);
    }

    if (tripId) {
        filters.push('AND', [
            SO_FIELD_TRIP,
            'is',
            tripId
        ]);
    }

    if (printedFieldId && !allowReprint) {
        filters.push('AND', [
            printedFieldId,
            'is',
            'F'
        ]);
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
            name: 'location',
            summary: search.Summary.GROUP
        }),
        search.createColumn({
            name: SO_FIELD_PICKER,
            summary: search.Summary.GROUP
        }),
        search.createColumn({
            name: SO_FIELD_TRUCK,
            summary: search.Summary.GROUP
        }),
        search.createColumn({
            name: SO_FIELD_TRIP,
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
            id: String(result.getValue({
                name: 'internalid',
                summary: search.Summary.GROUP
            })),
            recordType: 'salesorder',
            typeLabel: 'Sales Order',
            date: result.getValue({
                name: 'trandate',
                summary: search.Summary.GROUP
            }) || '',
            number: result.getValue({
                name: 'tranid',
                summary: search.Summary.GROUP
            }) || '',
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
            location: result.getText({
                name: 'location',
                summary: search.Summary.GROUP
            }) || '',
            picker: result.getText({
                name: SO_FIELD_PICKER,
                summary: search.Summary.GROUP
            }) || '',
            truck: result.getText({
                name: SO_FIELD_TRUCK,
                summary: search.Summary.GROUP
            }) || result.getValue({
                name: SO_FIELD_TRUCK,
                summary: search.Summary.GROUP
            }) || '',
            trip: result.getText({
                name: SO_FIELD_TRIP,
                summary: search.Summary.GROUP
            }) || result.getValue({
                name: SO_FIELD_TRIP,
                summary: search.Summary.GROUP
            }) || ''
        });

        /*
         * Scan beyond the 500 rows ultimately displayed so newer Sales
         * Orders without fulfillments do not crowd older eligible orders out
         * of the page. ResultSet.each() supports up to 4,000 results.
         */
        return results.length < MAX_SALES_ORDER_CANDIDATES;
    });

    if (!results.length) {
        return results;
    }

    const fulfillmentMap = getItemFulfillmentNumberMap(
        results.map(order => order.id)
    );

    /*
     * A Sales Order is eligible for this page only when at least one
     * non-voided Item Fulfillment still exists. The same rule is checked
     * again during POST immediately before building the PDF.
     */
    return results.filter(order => !!fulfillmentMap[order.id]);
}

function searchEligibleTransferOrders(params) {
    const orderNumber = params[FIELD_ORDER_NUMBER];
    const locationId = params[FIELD_LOCATION];
    const salesRepId = params[FIELD_SALES_REP];
    const pickerId = params[FIELD_PICKER];
    const truckId = params[FIELD_TRUCK];
    const tripId = params[FIELD_TRIP];
    const allowReprint = params[FIELD_ALLOW_REPRINT] === 'T';
    const printedFieldId = getPrintedFieldId();

    /*
     * Sales Rep remains Sales Order-specific.
     * Picker is also available on Transfer Orders through
     * custbody_simplex_picked_by.
     */
    if (salesRepId) {
        return [];
    }

    const filters = [
        ['type', 'anyof', 'TrnfrOrd'],
        'AND',
        ['mainline', 'is', 'F'],
        'AND',
        ['shipping', 'is', 'F'],
        'AND',
        ['cogs', 'is', 'F'],
        'AND',
        ['closed', 'is', 'F'],
        'AND',
        ['item.type', 'noneof', [
            'Description',
            'Discount',
            'Markup',
            'Subtotal'
        ]]
    ];

    if (!allowReprint) {
        /*
         * Transfer Order transaction searches do not support needspick
         * as a search criterion. Use supported Transfer Order statuses
         * that can still have quantities left to fulfill.
         *
         * B = Pending Fulfillment
         * D = Partially Fulfilled
         * E = Pending Receipt / Partially Fulfilled
         *
         * Fully fulfilled Transfer Orders in Pending Receipt (F),
         * Received (G), Closed (H), etc. are excluded.
         */
        filters.push('AND', ['status', 'anyof', [
            'TrnfrOrd:B',
            'TrnfrOrd:D',
            'TrnfrOrd:E'
        ]]);
    }

    if (orderNumber) {
        filters.push('AND', ['tranid', 'contains', orderNumber]);
    }

    if (locationId) {
        /*
         * For Transfer Orders, location is the FROM / source location.
         * transferlocation is the destination.
         */
        filters.push('AND', ['location', 'anyof', locationId]);
    }

    if (pickerId) {
        filters.push('AND', [
            SO_FIELD_PICKER,
            'anyof',
            pickerId
        ]);
    }

    if (truckId) {
        filters.push('AND', [
            SO_FIELD_TRUCK,
            'anyof',
            truckId
        ]);
    }

    if (tripId) {
        filters.push('AND', [
            SO_FIELD_TRIP,
            'is',
            tripId
        ]);
    }

    if (printedFieldId && !allowReprint) {
        filters.push('AND', [
            printedFieldId,
            'is',
            'F'
        ]);
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
            name: 'shipaddress',
            summary: search.Summary.GROUP
        }),
        search.createColumn({
            name: 'shipmethod',
            summary: search.Summary.GROUP
        }),
        search.createColumn({
            name: 'location',
            summary: search.Summary.GROUP
        }),
        search.createColumn({
            name: 'transferlocation',
            summary: search.Summary.GROUP
        }),
        search.createColumn({
            name: SO_FIELD_PICKER,
            summary: search.Summary.GROUP
        }),
        search.createColumn({
            name: SO_FIELD_TRUCK,
            summary: search.Summary.GROUP
        }),
        search.createColumn({
            name: SO_FIELD_TRIP,
            summary: search.Summary.GROUP
        })
    ];

    const results = [];
    const seenTransferOrders = {};

    search.create({
        type: search.Type.TRANSFER_ORDER,
        filters,
        columns
    }).run().each(result => {
        const internalId = String(result.getValue({
            name: 'internalid',
            summary: search.Summary.GROUP
        }) || '');

        if (!internalId || seenTransferOrders[internalId]) {
            return true;
        }

        seenTransferOrders[internalId] = true;

        results.push({
            id: internalId,
            recordType: 'transferorder',
            typeLabel: 'Transfer Order',
            date: result.getValue({
                name: 'trandate',
                summary: search.Summary.GROUP
            }) || '',
            number: result.getValue({
                name: 'tranid',
                summary: search.Summary.GROUP
            }) || '',
            customer: result.getText({
                name: 'transferlocation',
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
            location: result.getText({
                name: 'location',
                summary: search.Summary.GROUP
            }) || '',
            picker: result.getText({
                name: SO_FIELD_PICKER,
                summary: search.Summary.GROUP
            }) || result.getValue({
                name: SO_FIELD_PICKER,
                summary: search.Summary.GROUP
            }) || '',
            truck: result.getText({
                name: SO_FIELD_TRUCK,
                summary: search.Summary.GROUP
            }) || result.getValue({
                name: SO_FIELD_TRUCK,
                summary: search.Summary.GROUP
            }) || '',
            trip: result.getText({
                name: SO_FIELD_TRIP,
                summary: search.Summary.GROUP
            }) || result.getValue({
                name: SO_FIELD_TRIP,
                summary: search.Summary.GROUP
            }) || ''
        });

        return results.length < 500;
    });

    /*
     * Keep the body-level source/destination values used by the original
     * script, but resolve them adaptively. Small result sets use the cheaper
     * 1-unit lookups; larger result sets use one 10-unit mainline search.
     */
    applyTransferBodyLocations(results);

    return results;
}

function applyTransferBodyLocations(transferOrders) {
    if (!transferOrders || !transferOrders.length) {
        return;
    }

    const locationMap = {};

    if (transferOrders.length < 10) {
        transferOrders.forEach(order => {
            try {
                const lookup = search.lookupFields({
                    type: search.Type.TRANSFER_ORDER,
                    id: order.id,
                    columns: ['location', 'transferlocation']
                });

                locationMap[order.id] = {
                    source: getLookupSelectText(lookup, 'location'),
                    destination: getLookupSelectText(
                        lookup,
                        'transferlocation'
                    )
                };
            } catch (e) {
                log.error({
                    title: 'Unable to read Transfer Order locations: ' +
                        order.id,
                    details: serializeError(e)
                });
            }
        });
    } else {
        try {
            search.create({
                type: search.Type.TRANSFER_ORDER,
                filters: [
                    ['internalid', 'anyof', transferOrders.map(order => order.id)],
                    'AND',
                    ['mainline', 'is', 'T']
                ],
                columns: [
                    search.createColumn({ name: 'internalid' }),
                    search.createColumn({ name: 'location' }),
                    search.createColumn({ name: 'transferlocation' })
                ]
            }).run().each(result => {
                const id = String(
                    result.getValue({ name: 'internalid' }) || ''
                );

                if (id) {
                    locationMap[id] = {
                        source:
                            result.getText({ name: 'location' }) || '',
                        destination:
                            result.getText({ name: 'transferlocation' }) || ''
                    };
                }

                return true;
            });
        } catch (e) {
            log.error({
                title: 'Unable to batch-load Transfer Order locations',
                details: serializeError(e)
            });
        }
    }

    transferOrders.forEach(order => {
        const bodyValues = locationMap[order.id];

        if (!bodyValues) {
            return;
        }

        order.location = bodyValues.source || order.location;
        order.customer = bodyValues.destination || order.customer;
    });
}

    function buildResultsHtml(orders) {
        let rows = '';

        if (!orders.length) {
            rows = `
                <tr>
                    <td colspan="12" style="padding:12px;text-align:center;">
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
                   data-number="${escapeHtml(order.number)}"
                   data-recordtype="${escapeHtml(order.recordType)}">
        </td>
        <td>${escapeHtml(order.date)}</td>
        <td>${escapeHtml(order.typeLabel)}</td>
        <td>${escapeHtml(order.number)}</td>
        <td>${escapeHtml(order.id)}</td>
        <td>${escapeHtml(order.customer)}</td>
        <td>${escapeHtml(order.shipTo).replace(/\n/g, '<br>')}</td>
        <td>${escapeHtml(order.shipVia)}</td>
<td>${escapeHtml(order.location)}</td>
<td>${escapeHtml(order.picker)}</td>
<td>${escapeHtml(order.truck)}</td>
<td>${escapeHtml(order.trip)}</td>
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
<th>Location</th>
<th>Picker</th>
<th>Truck</th>
<th>Trip #</th>
    </tr>
</thead>
                    <tbody>
                        ${rows}
                    </tbody>
                </table>
            </div>
        `;
    }

    function printPickingTickets(context) {
    const selectedJson =
        context.request.parameters[FIELD_SELECTED] || '[]';

    let selectedOrders;

    try {
        selectedOrders = JSON.parse(selectedJson);
    } catch (e) {
        throw new Error('Unable to read selected orders.');
    }

    const selectedIds = [];
    const selectedIdMap = {};

    selectedOrders.forEach(order => {
        const id = String((order && order.id) || '');

        if (id && !selectedIdMap[id]) {
            selectedIds.push(id);
            selectedIdMap[id] = true;
        }
    });

    if (!selectedIds.length) {
        throw new Error(
            'Please select at least one order to print.'
        );
    }

    assertSafePrintBatchSize(selectedIds.length);

    /*
     * The existing Client Script only needs to submit transaction IDs.
     * Resolve whether each selected ID is a Sales Order or Transfer Order
     * here on the server.
     */
    const transactionRefs =
        resolveTransactionTypes(selectedIds);

    if (!transactionRefs.length) {
        throw new Error(
            'Unable to identify the selected transaction(s).'
        );
    }

    const validation =
        validatePrintableTransactions(transactionRefs);

    if (validation.invalidOrders.length) {
        throw new Error(
            'The following transaction(s) can no longer be printed: ' +
            validation.invalidOrders.join(', ')
        );
    }

    const fulfillmentMap = getItemFulfillmentNumberMap(
        validation.validTransactions.map(ref => ref.id)
    );

    const salesOrdersWithoutFulfillment =
        validation.validTransactions
            .filter(ref => (
                ref.recordType === 'salesorder' &&
                !fulfillmentMap[String(ref.id)]
            ))
            .map(ref => ref.number || ref.id);

    if (salesOrdersWithoutFulfillment.length) {
        throw createNamedError(
            'PT_ITEM_FULFILLMENT_REQUIRED',
            'Picking tickets cannot be printed for these Sales Orders ' +
            'because they do not have an active Item Fulfillment: ' +
            salesOrdersWithoutFulfillment.join(', ') + '. Refresh the ' +
            'page after the Item Fulfillment has been created.'
        );
    }

    const orders = getPickingTicketData(
        validation.validTransactions,
        fulfillmentMap
    );

    if (!orders.length) {
        throw new Error(
            'No printable picking ticket data was found for ' +
            'the selected transaction(s).'
        );
    }

    populateVendorItemCodes(orders);

    ensureUsageForPdfAndPrintedFlags(
        validation.validTransactions.length
    );

    const logoUrl = getLogoUrl();
    const xml = buildPdfSetXml(orders, logoUrl);

    const pdfFile = render.xmlToPdf({
        xmlString: xml
    });

    pdfFile.name = 'Picking_Tickets.pdf';

    markTransactionsAsPrinted(
        validation.validTransactions
    );

    log.audit({
        title: 'Picking Tickets Generated',
        details: JSON.stringify({
            transactionCount: orders.length,
            remainingUsage:
                runtime.getCurrentScript().getRemainingUsage()
        })
    });

    context.response.writeFile({
        file: pdfFile,
        isInline: true
    });
}

function resolveTransactionTypes(transactionIds) {
    const refs = [];
    const seen = {};

    search.create({
        type: search.Type.TRANSACTION,
        filters: [
            ['internalid', 'anyof', transactionIds],
            'AND',
            ['mainline', 'is', 'T'],
            'AND',
            ['type', 'anyof', [
                'SalesOrd',
                'TrnfrOrd'
            ]]
        ],
        columns: [
            search.createColumn({ name: 'internalid' }),
            search.createColumn({ name: 'type' }),
            search.createColumn({ name: 'tranid' }),
            search.createColumn({ name: SO_FIELD_PICKER }),
            search.createColumn({ name: SO_FIELD_TRUCK }),
            search.createColumn({ name: SO_FIELD_TRIP })
        ]
    }).run().each(result => {
        const id = String(
            result.getValue({ name: 'internalid' })
        );

        if (seen[id]) {
            return true;
        }

        const typeValue =
            result.getValue({ name: 'type' }) || '';

        const typeText =
            result.getText({ name: 'type' }) || '';

        let recordType = '';

        if (
            typeValue === 'SalesOrd' ||
            /sales order/i.test(typeText)
        ) {
            recordType = 'salesorder';
        } else if (
            typeValue === 'TrnfrOrd' ||
            /transfer order/i.test(typeText)
        ) {
            recordType = 'transferorder';
        }

        if (recordType) {
            refs.push({
                id: id,
                recordType: recordType,
                number:
                    result.getValue({ name: 'tranid' }) || id,
                picker: getSearchDisplayValue(
                    result,
                    SO_FIELD_PICKER
                ),
                truck: getSearchDisplayValue(
                    result,
                    SO_FIELD_TRUCK
                ),
                trip: getSearchDisplayValue(
                    result,
                    SO_FIELD_TRIP
                )
            });
            seen[id] = true;
        }

        return true;
    });

    return refs;
}

function validatePrintableTransactions(transactionRefs) {
    const validTransactions = [];
    const invalidOrders = [];
    const validIdMap = {};
    const salesOrderIds = transactionRefs
        .filter(ref => ref.recordType === 'salesorder')
        .map(ref => ref.id);
    const transferOrderIds = transactionRefs
        .filter(ref => ref.recordType === 'transferorder')
        .map(ref => ref.id);

    /*
     * Validate each transaction type in one search. The previous version ran
     * one 10-unit ResultSet.each() for every selected transaction.
     */
    if (salesOrderIds.length) {
        search.create({
            type: search.Type.SALES_ORDER,
            filters: [
                ['internalid', 'anyof', salesOrderIds],
                'AND',
                ['mainline', 'is', 'T'],
                'AND',
                ['status', 'noneof', [
                    'SalesOrd:C',
                    'SalesOrd:G',
                    'SalesOrd:H'
                ]]
            ],
            columns: [
                search.createColumn({ name: 'internalid' })
            ]
        }).run().each(result => {
            const id = String(
                result.getValue({ name: 'internalid' }) || ''
            );

            if (id) {
                validIdMap[id] = true;
            }

            return true;
        });
    }

    if (transferOrderIds.length) {
        search.create({
            type: search.Type.TRANSFER_ORDER,
            filters: [
                ['internalid', 'anyof', transferOrderIds],
                'AND',
                ['mainline', 'is', 'T'],
                'AND',
                ['voided', 'is', 'F']
            ],
            columns: [
                search.createColumn({ name: 'internalid' })
            ]
        }).run().each(result => {
            const id = String(
                result.getValue({ name: 'internalid' }) || ''
            );

            if (id) {
                validIdMap[id] = true;
            }

            return true;
        });
    }

    transactionRefs.forEach(ref => {
        if (validIdMap[String(ref.id)]) {
            validTransactions.push(ref);
        } else {
            invalidOrders.push(ref.number || ref.id);
        }
    });

    return {
        validTransactions: validTransactions,
        invalidOrders: invalidOrders
    };
}

function markTransactionsAsPrinted(transactionRefs) {
    const printedFieldId = getPrintedFieldId();

    if (!printedFieldId) {
        return;
    }

    transactionRefs.forEach(ref => {
        try {
            if (
                runtime.getCurrentScript().getRemainingUsage() <
                (10 + PRINT_FINALIZATION_BUFFER)
            ) {
                throw createNamedError(
                    'PT_INSUFFICIENT_USAGE',
                    'NetSuite governance became too low while marking ' +
                    'the printed transactions. Print a smaller batch.'
                );
            }

            const recordType =
                ref.recordType === 'transferorder'
                    ? record.Type.TRANSFER_ORDER
                    : record.Type.SALES_ORDER;

            record.submitFields({
                type: recordType,
                id: ref.id,
                values: {
                    [printedFieldId]: true
                },
                options: {
                    enableSourcing: false,
                    ignoreMandatoryFields: true
                }
            });
        } catch (e) {
            if (
                isUsageLimitError(e) ||
                (e && e.name === 'PT_INSUFFICIENT_USAGE')
            ) {
                throw e;
            }

            log.error({
                title:
                    'Unable to mark transaction as printed: ' +
                    ref.id,
                details: serializeError(e)
            });
        }
    });
}

    function getPickingTicketData(transactionRefs, fulfillmentMap) {
    return transactionRefs
        .map(ref => {
            if (ref.recordType === 'transferorder') {
                return buildPickingTicketFromTransferOrder(
                    ref,
                    fulfillmentMap[ref.id] || ''
                );
            }

            return buildPickingTicketFromSalesOrder(
                ref,
                fulfillmentMap[ref.id] || ''
            );
        })
        .filter(order => (
            order &&
            order.lines &&
            order.lines.length
        ));
}

function buildPickingTicketFromSalesOrder(
    transactionRef,
    fulfillmentNumbers
) {
    const salesOrderId = transactionRef.id;
    const soRec = record.load({
        type: record.Type.SALES_ORDER,
        id: salesOrderId,
        isDynamic: false
    });

const order = {
    id: String(salesOrderId),
    recordType: 'salesorder',
    typeLabel: 'Sales Order',
    date: soRec.getText({ fieldId: 'trandate' }) || soRec.getValue({ fieldId: 'trandate' }) || '',
    number: soRec.getValue({ fieldId: 'tranid' }) || '',
    customer: soRec.getText({ fieldId: 'entity' }) || '',
    shipTo: cleanPdfAddress(soRec.getValue({ fieldId: 'shipaddress' }) || ''),
    shipVia: soRec.getText({ fieldId: 'shipmethod' }) || '',
location: soRec.getText({ fieldId: 'location' }) || '',
salesRep: soRec.getText({ fieldId: 'salesrep' }) ||
    soRec.getValue({ fieldId: 'salesrep' }) || '',
enteredBy: soRec.getText({ fieldId: SO_FIELD_SALES_REP }) ||
    soRec.getValue({ fieldId: SO_FIELD_SALES_REP }) || '',
pickingTicketMemo:
    soRec.getValue({ fieldId: SO_FIELD_PICKING_TICKET_MEMO }) || '',
picker: getRecordDisplayValue(soRec, SO_FIELD_PICKER) ||
    transactionRef.picker || '',
truck: getRecordDisplayValue(soRec, SO_FIELD_TRUCK) ||
    transactionRef.truck || '',
trip: getRecordDisplayValue(soRec, SO_FIELD_TRIP) ||
    transactionRef.trip || '',
fulfillmentNumbers: fulfillmentNumbers,
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

const itemId = soRec.getSublistValue({
    sublistId: 'item',
    fieldId: 'item',
    line: i
});

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
    vendorItemCode: '',
    itemId: itemId,
    itemType: itemType,
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

    return order;
}

function buildPickingTicketFromTransferOrder(
    transactionRef,
    fulfillmentNumbers
) {
    const transferOrderId = transactionRef.id;
    const toRec = record.load({
        type: record.Type.TRANSFER_ORDER,
        id: transferOrderId,
        isDynamic: false
    });

    const destination =
        toRec.getText({ fieldId: 'transferlocation' }) || '';

    const order = {
        id: String(transferOrderId),
        recordType: 'transferorder',
        typeLabel: 'Transfer Order',
        date:
            toRec.getText({ fieldId: 'trandate' }) ||
            toRec.getValue({ fieldId: 'trandate' }) ||
            '',
        number:
            toRec.getValue({ fieldId: 'tranid' }) || '',
        customer: destination,
        shipTo: cleanPdfAddress(
            toRec.getValue({ fieldId: 'shipaddress' }) || ''
        ),
        shipVia:
            toRec.getText({ fieldId: 'shipmethod' }) || '',
        location:
            toRec.getText({ fieldId: 'location' }) || '',
        salesRep: '',
        enteredBy: '',
        pickingTicketMemo: '',
        picker: getRecordDisplayValue(
            toRec,
            SO_FIELD_PICKER
        ) || transactionRef.picker || '',
        truck: getRecordDisplayValue(
            toRec,
            SO_FIELD_TRUCK
        ) || transactionRef.truck || '',
        trip: getRecordDisplayValue(
            toRec,
            SO_FIELD_TRIP
        ) || transactionRef.trip || '',
        fulfillmentNumbers: fulfillmentNumbers,
        lines: []
    };

    const lineCount = toRec.getLineCount({
        sublistId: 'item'
    });

    for (let i = 0; i < lineCount; i++) {
        const isClosed = toRec.getSublistValue({
            sublistId: 'item',
            fieldId: 'isclosed',
            line: i
        });

        if (isClosed === true || isClosed === 'T') {
            continue;
        }

        const itemType = toRec.getSublistValue({
            sublistId: 'item',
            fieldId: 'itemtype',
            line: i
        });

        if (
            [
                'Description',
                'Discount',
                'Markup',
                'Subtotal',
                'Group',
                'EndGroup'
            ].indexOf(itemType) !== -1
        ) {
            continue;
        }

        const itemId = toRec.getSublistValue({
            sublistId: 'item',
            fieldId: 'item',
            line: i
        });

        const code = toRec.getSublistText({
            sublistId: 'item',
            fieldId: 'item',
            line: i
        }) || '';

        const description =
            toRec.getSublistValue({
                sublistId: 'item',
                fieldId: 'description',
                line: i
            }) || '';

        const quantity = toNumber(
            toRec.getSublistValue({
                sublistId: 'item',
                fieldId: 'quantity',
                line: i
            })
        );

        const quantityFulfilled = toNumber(
            toRec.getSublistValue({
                sublistId: 'item',
                fieldId: 'quantityfulfilled',
                line: i
            })
        );

        const qtyRemaining =
            Math.max(quantity - quantityFulfilled, 0);

        /*
         * Normal printing uses the remaining quantity.
         * If this is a reprint after fulfillment, preserve the
         * original Transfer Order quantity instead of printing 0.
         */
        const qtyToPrint =
            qtyRemaining > 0
                ? qtyRemaining
                : quantity;

        const units = toRec.getSublistText({
            sublistId: 'item',
            fieldId: 'units',
            line: i
        }) || '';

        order.lines.push({
            code: code,
            vendorItemCode: '',
            itemId: itemId,
            itemType: itemType,
            description: description,
            quantity: qtyRemaining,
            committed: 0,
            pickQty: qtyToPrint,
            units: units,
            onHand: '',
            location: order.location
        });
    }

    return order;
}


function getItemSearchType(itemType) {
    switch (itemType) {
        case 'InvtPart':
            return search.Type.INVENTORY_ITEM;

        case 'Assembly':
            return search.Type.ASSEMBLY_ITEM;

        case 'NonInvtPart':
            return search.Type.NON_INVENTORY_ITEM;

        case 'Service':
            return search.Type.SERVICE_ITEM;

        case 'OthCharge':
            return search.Type.OTHER_CHARGE_ITEM;

        default:
            return '';
    }
}

function populateVendorItemCodes(orders) {
    const searchGroups = {};

    orders.forEach(order => {
        order.lines.forEach(line => {
            const itemId = String(line.itemId || '');
            const itemType = String(line.itemType || '');
            const searchType = getItemSearchType(itemType);
            const cacheKey = itemType + ':' + itemId;

            if (!itemId || !searchType) {
                vendorItemCodeCache[cacheKey] = '';
                return;
            }

            if (
                Object.prototype.hasOwnProperty.call(
                    vendorItemCodeCache,
                    cacheKey
                )
            ) {
                return;
            }

            const groupKey = String(searchType);

            if (!searchGroups[groupKey]) {
                searchGroups[groupKey] = {
                    searchType: searchType,
                    items: {}
                };
            }

            searchGroups[groupKey].items[itemId] = itemType;
            vendorItemCodeCache[cacheKey] = '';
        });
    });

    Object.keys(searchGroups).forEach(groupKey => {
        const group = searchGroups[groupKey];
        const itemIds = Object.keys(group.items);

        if (!itemIds.length) {
            return;
        }

        try {
            search.create({
                type: group.searchType,
                filters: [
                    ['internalid', 'anyof', itemIds]
                ],
                columns: [
                    search.createColumn({ name: 'internalid' }),
                    search.createColumn({ name: 'vendorname' })
                ]
            }).run().each(result => {
                const itemId = String(
                    result.getValue({ name: 'internalid' }) || ''
                );
                const itemType = group.items[itemId] || '';

                if (itemId && itemType) {
                    vendorItemCodeCache[itemType + ':' + itemId] = String(
                        result.getValue({ name: 'vendorname' }) || ''
                    );
                }

                return true;
            });
        } catch (e) {
            /*
             * Preserve the old per-item lookup as an exceptional fallback.
             * Governance is checked before every lookup so this path cannot
             * consume the units reserved for PDF generation and marking.
             */
            itemIds.forEach(itemId => {
                const itemType = group.items[itemId];
                const cacheKey = itemType + ':' + itemId;
                const unitsNeededToFinish =
                    (orders.length * 10) +
                    PRINT_FINALIZATION_BUFFER +
                    10;

                if (
                    runtime.getCurrentScript().getRemainingUsage() <=
                    unitsNeededToFinish
                ) {
                    throw createNamedError(
                        'PT_INSUFFICIENT_USAGE',
                        'NetSuite could not batch-load Vendor Item Codes and ' +
                        'does not have enough usage for individual lookups. ' +
                        'Print a smaller batch.'
                    );
                }

                const itemData = search.lookupFields({
                    type: group.searchType,
                    id: itemId,
                    columns: ['vendorname']
                });

                vendorItemCodeCache[cacheKey] = String(
                    itemData.vendorname || ''
                );
            });

            log.error({
                title: 'Vendor Item Code batch search used fallback',
                details: serializeError(e)
            });
        }
    });

    orders.forEach(order => {
        order.lines.forEach(line => {
            const cacheKey =
                String(line.itemType || '') + ':' +
                String(line.itemId || '');

            line.vendorItemCode = vendorItemCodeCache[cacheKey] || '';
        });
    });
}

function getItemFulfillmentNumberMap(transactionIds) {
    const fulfillmentMap = {};
    const seenByTransaction = {};
    const uniqueTransactionIds = [];
    const transactionIdSet = {};

    if (!transactionIds || !transactionIds.length) {
        return fulfillmentMap;
    }

    transactionIds.forEach(id => {
        const stringId = String(id || '');

        if (!stringId || transactionIdSet[stringId]) {
            return;
        }

        transactionIdSet[stringId] = true;
        uniqueTransactionIds.push(stringId);
        fulfillmentMap[stringId] = [];
        seenByTransaction[stringId] = {};
    });

    try {
        chunkArray(
            uniqueTransactionIds,
            SEARCH_FILTER_ID_CHUNK_SIZE
        ).forEach(idChunk => {
            search.create({
                type: search.Type.ITEM_FULFILLMENT,
                filters: [
                    ['mainline', 'is', 'T'],
                    'AND',
                    ['createdfrom', 'anyof', idChunk],
                    'AND',
                    ['voided', 'is', 'F']
                ],
                columns: [
                    search.createColumn({ name: 'createdfrom' }),
                    search.createColumn({
                        name: 'trandate',
                        sort: search.Sort.ASC
                    }),
                    search.createColumn({
                        name: 'tranid',
                        sort: search.Sort.ASC
                    })
                ]
            }).run().each(result => {
                const sourceId = String(
                    result.getValue({ name: 'createdfrom' }) || ''
                );
                const fulfillmentNumber = String(
                    result.getValue({ name: 'tranid' }) || ''
                );

                if (
                    sourceId &&
                    fulfillmentNumber &&
                    fulfillmentMap[sourceId] &&
                    !seenByTransaction[sourceId][fulfillmentNumber]
                ) {
                    fulfillmentMap[sourceId].push(fulfillmentNumber);
                    seenByTransaction[sourceId][fulfillmentNumber] = true;
                }

                return true;
            });
        });
    } catch (e) {
        log.error({
            title: 'Unable to batch-load Item Fulfillment numbers',
            details: serializeError(e)
        });

        /*
         * Fail closed. An unavailable fulfillment search must never be
         * mistaken for proof that an order has no fulfillment, and printing
         * must not continue when the prerequisite cannot be verified.
         */
        throw createNamedError(
            'PT_FULFILLMENT_LOOKUP_FAILED',
            'NetSuite could not verify the Item Fulfillments. No picking ' +
            'tickets were printed. Details: ' + getErrorMessage(e)
        );
    }

    Object.keys(fulfillmentMap).forEach(id => {
        fulfillmentMap[id] = fulfillmentMap[id].join(', ');
    });

    return fulfillmentMap;
}

function chunkArray(values, chunkSize) {
    const chunks = [];

    for (let start = 0; start < values.length; start += chunkSize) {
        chunks.push(values.slice(start, start + chunkSize));
    }

    return chunks;
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
        <td class="code-column">
            ${xmlEscape(line.code)}
        </td>

        <td class="vendor-item-column">
            ${xmlEscape(line.vendorItemCode)}
        </td>

        <td class="description-column">
            ${xmlEscape(line.description)}
        </td>

            <td class="quantity-column">
                ${formatQty(line.pickQty)}
            </td>

            <td class="unit-column">
                ${xmlEscape(line.units)}
            </td>

            <td class="picked-column">
                &nbsp;
            </td>

            <td class="onhand-column last-cell">
                ${formatQty(line.onHand)}
            </td>
        </tr>
    `).join('');

    const blankRows = '';

    const logoHtml = logoUrl
        ? `
            <img
                src="${xmlEscape(logoUrl)}"
                style="width:155px;height:39px;"
            />
        `
        : `
            <span style="font-size:17pt;font-weight:bold;color:#174f7a;">
                SIMPLEX
            </span>
            <br/>
            <span style="font-size:6pt;letter-spacing:1px;color:#666666;">
                TRADING CO. LTD.
            </span>
        `;

    return `
        <pdf>
            <head>
                <macrolist>
                    <macro id="ticketFooter">
                        <table class="footer-table">
                            <tr>
                                <td style="width:30%;">
                                    <barcode
                                        codetype="code128"
                                        showtext="true"
                                        value="${xmlEscape(order.number)}"
                                    />
                                </td>

                                <td style="width:40%;">
                                    &nbsp;
                                </td>

                                <td style="width:30%;text-align:right;">
                                    <pagenumber/> of <totalpages/>
                                </td>
                            </tr>
                        </table>
                    </macro>
                </macrolist>

                <style>
                    body {
    font-family: Helvetica, Arial, sans-serif;
    font-size: 10pt;
    color: #222222;
}

                    table {
                        width: 100%;
                        border-collapse: collapse;
                        table-layout: fixed;
                    }

                    td {
                        padding: 0;
                    }

                    .date-order-table {
                        border: 0.75px solid #222222;
                    }

                    .date-order-table td {
                        border-right: 0.75px solid #222222;
                        padding: 3px;
                    }

                    .date-order-table td.last-date-cell {
                        border-right: none;
                    }

                    .date-order-header td {
    border-bottom: 0.75px solid #222222;
    font-size: 9pt;
    font-weight: bold;
}

.date-order-value td {
    font-size: 10pt;
}

.fulfillment-row {
    margin-top: 3px;
    font-size: 9pt;
}

.fulfillment-label {
    font-weight: bold;
}

.fulfillment-value {
    font-size: 10pt;
}

                    .ship-box {
                        border: 0.75px solid #222222;
                        padding: 4px;
                        height: 58px;
                        vertical-align: top;
                    }

                    .ship-label {
    font-size: 10pt;
    font-weight: bold;
}

                    .ship-address {
    font-size: 10pt;
    line-height: 12pt;
}

                    .assignment-label {
    padding-bottom: 2px;
    font-size: 10pt;
    font-weight: bold;
    text-align: center;
}

                    .assignment-value {
    border: 0.75px solid #222222;
    padding: 3px;
    height: 16px;
    font-size: 10pt;
    text-align: center;
}

                    .rep-info-table {
                        margin-top: 6px;
                    }

                    .rep-info-label {
                        font-size: 9pt;
                        font-weight: bold;
                        padding-bottom: 2px;
                    }

                    .rep-info-value {
                        border: 0.75px solid #222222;
                        padding: 3px 4px;
                        height: 16px;
                        font-size: 10pt;
                    }

                    .memo-table {
                        margin-top: 6px;
                        border: 0.75px solid #222222;
                    }

                    .memo-label {
                        padding: 3px 4px 2px 4px;
                        font-size: 9pt;
                        font-weight: bold;
                    }

                    .memo-value {
                        padding: 3px 4px 5px 4px;
                        font-size: 10pt;
                        line-height: 12pt;
                    }

                    .item-table {
                        border: 0.75px solid #222222;
                    }

                    .item-table th {
    border-right: 0.75px solid #222222;
    border-bottom: 0.75px solid #222222;
    padding: 5px 4px;
    font-size: 10pt;
    font-weight: bold;
    text-align: left;
    vertical-align: middle;
}

                    .item-table th.last-header {
                        border-right: none;
                    }

.item-table td {
    border-right: 0.75px solid #222222;
    padding: 4px;
    font-size: 10pt;
    vertical-align: top;
}

                    .item-table td.last-cell {
                        border-right: none;
                    }

.code-column {
    width: 12%;
}

.vendor-item-column {
    width: 14%;
}

.description-column {
    width: 28%;
}

.quantity-column {
    width: 7%;
    text-align: right;
}

.unit-column {
    width: 8%;
    text-align: center;
}

.picked-column {
    width: 14%;
    text-align: center;
}

.onhand-column {
    width: 17%;
    text-align: right;
}

                    .footer-table td {
                        padding: 0;
                        font-size: 8pt;
                        vertical-align: bottom;
                    }
                </style>
            </head>

            <body
                footer="ticketFooter"
                footer-height="32pt"
                padding="0.28in"
                size="Letter"
            >

                <!-- Logo and Date / Order -->
                <table>
                    <tr>
                        <td style="width:64%;vertical-align:top;">
                            ${logoHtml}
                        </td>

                        <td style="width:2%;">
                            &nbsp;
                        </td>

                        <td style="width:34%;vertical-align:top;">
<table class="date-order-table">
    <tr class="date-order-header">
        <td style="width:50%;">
            DATE
        </td>

        <td
            class="last-date-cell"
            style="width:50%;"
        >
            ORDER #
        </td>
    </tr>

    <tr class="date-order-value">
        <td>
            ${xmlEscape(order.date)}
        </td>

        <td class="last-date-cell">
            ${xmlEscape(order.number)}
        </td>
    </tr>
</table>

<table class="fulfillment-row">
    <tr>
        <td>
            <span class="fulfillment-label">
                ITEM FULFILLMENT #
            </span>

            <span class="fulfillment-value">
                ${xmlEscape(order.fulfillmentNumbers) || '&nbsp;'}
            </span>
        </td>
    </tr>
</table>
                        </td>
                    </tr>
                </table>

                <div style="height:5px;">
                    &nbsp;
                </div>

                <!-- Ship To, Picker and Truck -->
                <table>
                    <tr>
                        <td
                            class="ship-box"
                            style="width:46%;"
                        >
                            <span class="ship-label">
                                SHIP TO:
                            </span>
                            <br/>

                            <span class="ship-address">
                                ${xmlEscape(order.customer)}
                                <br/>
                                ${xmlEscape(order.shipTo).replace(/\n/g, '<br/>')}
                            </span>
                        </td>

<td style="width:8%;">
    &nbsp;
</td>

<td style="width:13%;vertical-align:bottom;">
    <table>
        <tr>
            <td class="assignment-label">
                PICKER
            </td>
        </tr>

        <tr>
            <td class="assignment-value">
                ${xmlEscape(order.picker) || '&nbsp;'}
            </td>
        </tr>
    </table>
</td>

<td style="width:3%;">
    &nbsp;
</td>

<td style="width:13%;vertical-align:bottom;">
    <table>
        <tr>
            <td class="assignment-label">
                TRUCK
            </td>
        </tr>

        <tr>
            <td class="assignment-value">
                ${xmlEscape(order.truck) || '&nbsp;'}
            </td>
        </tr>
    </table>
</td>

<td style="width:3%;">
    &nbsp;
</td>

<td style="width:13%;vertical-align:bottom;">
    <table>
        <tr>
            <td class="assignment-label">
                TRIP #
            </td>
        </tr>

        <tr>
            <td class="assignment-value">
                ${xmlEscape(order.trip) || '&nbsp;'}
            </td>
        </tr>
    </table>
</td>

<td style="width:1%;">
    &nbsp;
</td>
                    </tr>
                </table>

                <table class="rep-info-table">
                    <tr>
                        <td style="width:46%;">
                            &nbsp;
                        </td>

                        <td style="width:8%;">
                            &nbsp;
                        </td>

                        <td style="width:21%;vertical-align:top;">
                            <table>
                                <tr>
                                    <td class="rep-info-label">
                                        SALES REP
                                    </td>
                                </tr>
                                <tr>
                                    <td class="rep-info-value">
                                        ${xmlEscape(order.salesRep) || '&nbsp;'}
                                    </td>
                                </tr>
                            </table>
                        </td>

                        <td style="width:3%;">
                            &nbsp;
                        </td>

                        <td style="width:21%;vertical-align:top;">
                            <table>
                                <tr>
                                    <td class="rep-info-label">
                                        ENTERED BY
                                    </td>
                                </tr>
                                <tr>
                                    <td class="rep-info-value">
                                        ${xmlEscape(order.enteredBy) || '&nbsp;'}
                                    </td>
                                </tr>
                            </table>
                        </td>

                        <td style="width:1%;">
                            &nbsp;
                        </td>
                    </tr>
                </table>

                ${order.pickingTicketMemo ? `
                <table class="memo-table">
                    <tr>
                        <td class="memo-label">
                            PICKING TICKET MEMO
                        </td>
                    </tr>
                    <tr>
                        <td class="memo-value">
                            ${xmlEscape(order.pickingTicketMemo)}
                        </td>
                    </tr>
                </table>
                ` : ''}

                <div style="height:10px;">
                    &nbsp;
                </div>

                <!-- Item Lines -->
                <table class="item-table">
                    <thead>
                        <tr>
<th class="code-column">
    CODE
</th>

<th class="vendor-item-column">
    VEN ITEM
</th>

<th class="description-column">
    DESCRIPTION
</th>

                            <th class="quantity-column">
                                QTY
                            </th>

                            <th class="unit-column">
                                UNIT
                            </th>

                            <th class="picked-column">
                                PICKED
                            </th>

                            <th class="onhand-column last-header">
                                ON HAND
                            </th>
                        </tr>
                    </thead>

<tbody>
    ${lines}
</tbody>
                </table>

            </body>
        </pdf>
    `;
}
function assertSafePrintBatchSize(transactionCount) {
    const remainingUsage =
        runtime.getCurrentScript().getRemainingUsage();
    const safeMaximum = Math.max(
        1,
        Math.floor(
            (remainingUsage - PRINT_FIXED_USAGE_RESERVE) /
            PRINT_USAGE_PER_TRANSACTION
        )
    );

    if (transactionCount > safeMaximum) {
        throw createNamedError(
            'PT_BATCH_TOO_LARGE',
            'Select no more than ' + safeMaximum +
            ' transactions per PDF. This protects the print request from ' +
            'NetSuite\'s Suitelet governance limit. Larger selections can ' +
            'be printed in multiple batches.'
        );
    }
}

function ensureUsageForPdfAndPrintedFlags(transactionCount) {
    const remainingUsage =
        runtime.getCurrentScript().getRemainingUsage();
    const requiredUsage =
        (transactionCount * 10) +
        PRINT_FINALIZATION_BUFFER +
        10;

    if (remainingUsage < requiredUsage) {
        throw createNamedError(
            'PT_INSUFFICIENT_USAGE',
            'NetSuite usage is too low to safely finish this print batch. ' +
            'No PDF was generated and no printed flags were changed. ' +
            'Please print a smaller selection.'
        );
    }
}

function getSearchDisplayValue(result, fieldId) {
    try {
        return result.getText({ name: fieldId }) ||
            result.getValue({ name: fieldId }) || '';
    } catch (e) {
        return result.getValue({ name: fieldId }) || '';
    }
}

function getRecordDisplayValue(recordObject, fieldId) {
    try {
        return recordObject.getText({ fieldId: fieldId }) ||
            recordObject.getValue({ fieldId: fieldId }) || '';
    } catch (e) {
        try {
            return recordObject.getValue({ fieldId: fieldId }) || '';
        } catch (ignored) {
            return '';
        }
    }
}

function createNamedError(name, message) {
    const errorObject = new Error(message);
    errorObject.name = name;
    return errorObject;
}

function getErrorMessage(errorObject) {
    if (!errorObject) {
        return 'An unexpected error occurred.';
    }

    return String(
        errorObject.message ||
        errorObject.details ||
        errorObject
    );
}

function serializeError(errorObject) {
    try {
        return JSON.stringify({
            name:
                (errorObject && errorObject.name) || 'ERROR',
            message: getErrorMessage(errorObject),
            stack:
                (errorObject && errorObject.stack) || '',
            causeCode:
                errorObject &&
                errorObject.cause &&
                errorObject.cause.code
                    ? errorObject.cause.code
                    : ''
        });
    } catch (ignored) {
        return getErrorMessage(errorObject);
    }
}

function isUsageLimitError(errorObject) {
    if (!errorObject) {
        return false;
    }

    const name = String(errorObject.name || '');
    const code = String(errorObject.code || '');
    const causeCode = String(
        (errorObject.cause && errorObject.cause.code) || ''
    );
    const message = getErrorMessage(errorObject);

    return (
        name === 'SSS_USAGE_LIMIT_EXCEEDED' ||
        code === 'SSS_USAGE_LIMIT_EXCEEDED' ||
        causeCode === 'SSS_USAGE_LIMIT_EXCEEDED' ||
        /usage limit exceeded/i.test(message)
    );
}

function writeLightweightErrorPage(context, message) {
    context.response.write({
        output: `
            <!doctype html>
            <html>
                <head>
                    <meta charset="utf-8">
                    <title>Print Picking Tickets</title>
                </head>
                <body style="font-family:Arial,sans-serif;padding:24px;">
                    <h2>Picking tickets were not printed</h2>
                    <p>${escapeHtml(message)}</p>
                    <p>
                        Use your browser's Back button, select fewer
                        transactions, and try again.
                    </p>
                </body>
            </html>
        `
    });
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
