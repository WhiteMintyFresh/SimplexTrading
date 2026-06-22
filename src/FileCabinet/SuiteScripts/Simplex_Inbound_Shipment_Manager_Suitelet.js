/**
 * @NApiVersion 2.1
 * @NScriptType Suitelet
 *
 * Simplex Inbound Shipment Manager
 *
 * IMPORTANT:
 * Update SELECT_SOURCES below with the actual custom list/custom record script IDs
 * used by the four select fields in your account.
 */
define([
    'N/ui/serverWidget',
    'N/search',
    'N/record',
    'N/format',
    'N/url',
    'N/log'
], (
    serverWidget,
    search,
    record,
    format,
    url,
    log
) => {

    const RECORD_TYPE = 'inboundshipment';
    const PAYLOAD_FIELD = 'custpage_shipment_payload';
    const PAGE_SIZE = 200;

    /*
     * For a custom list field, sourceType is the custom-list script ID.
     * Example: customlist_container_status
     *
     * For a custom record field, sourceType is the custom-record-type script ID.
     * Example: customrecord_shipping_line
     *
     * If left blank, the Suitelet renders that field as a text box and expects
     * an internal ID when saving.
     */
    const SELECT_SOURCES = {
        custrecord_shipping_line: 'customrecord_shipping_line',
        custrecord_dfl_status: 'customlist_dfl_status',
        custrecord_container_stat: 'customlist_container_stat',
        custrecord_shipping_code: 'customlist_shipping_code'
    };

    const EDITABLE_FIELDS = [
        { id: 'custrecord_shipping_line', label: 'Shipping Line', type: 'select' },
        { id: 'custrecord_container_size', label: 'Container Size (ft)', type: 'text' },
        { id: 'externaldocumentnumber', label: 'SN Number', type: 'text' },
        { id: 'vesselnumber', label: 'Container Number', type: 'text' },
        { id: 'expectedshippingdate', label: 'Expected Date of Delivery', type: 'date' },
        { id: 'actualshippingdate', label: 'Actual Date of Delivery', type: 'date' },
        { id: 'expecteddeliverydate', label: 'Expected Date of Arrival', type: 'date' },
        { id: 'actualdeliverydate', label: 'Actual Date of Arrival', type: 'date' },
        { id: 'custrecord_last_date', label: 'Last Day', type: 'date' },
        { id: 'custrecord_dfl_status', label: 'DFL Status', type: 'select' },
        { id: 'custrecord_vec_release', label: 'VEC Release', type: 'checkbox' },
        { id: 'custrecord_container_stat', label: 'Container Status', type: 'select' },
        { id: 'custrecord_customs_release_date', label: 'Customs Release Date', type: 'date' },
        { id: 'billoflading', label: 'C No', type: 'text' },
        { id: 'custrecord_shipping_code', label: 'Code', type: 'select' },
        { id: 'custrecord_fas', label: 'FAS', type: 'checkbox' },
        { id: 'custrecord_trucker_confirmation', label: 'Trucker Confirmation', type: 'checkbox' },
        { id: 'custrecord_offloading_date', label: 'Offloading Date', type: 'datetime' },
        { id: 'custrecord_t_no', label: 'T No', type: 'text' },
        { id: 'custrecord_cont_return_date', label: 'Container Return Date', type: 'date' },
        { id: 'shipmentmemo', label: 'Comments', type: 'textarea' }
    ];

    function onRequest(context) {
        try {
            if (context.request.method === 'GET') {
                renderForm(context, '');
                return;
            }

            processUpdates(context);
        } catch (error) {
            log.error({
                title: 'Inbound Shipment Suitelet Error',
                details: error
            });

            renderForm(
                context,
                `Unexpected error: ${escapeHtml(error.message || String(error))}`
            );
        }
    }

    function renderForm(context, message) {
        const params = context.request.parameters || {};

        const form = serverWidget.createForm({
            title: 'Simplex Inbound Shipment Manager'
        });

        form.addSubmitButton({
            label: 'Save Selected Shipments'
        });
        form.addButton({
    id: 'custpage_new_inbound_shipment',
    label: 'New Inbound Shipment',
    functionName: 'createNewInboundShipment'
});

        addMessageField(form, message);
        addPayloadField(form);
        addFilterFields(form, params);

        const shipments = getInboundShipments(params);
        addShipmentGrid(form, shipments);

        context.response.writePage(form);
    }

    function addMessageField(form, message) {
        if (!message) {
            return;
        }

        const field = form.addField({
            id: 'custpage_message',
            label: 'Message',
            type: serverWidget.FieldType.INLINEHTML
        });

        field.defaultValue = `
            <div style="
                padding:10px;
                margin:8px 0 12px;
                border:1px solid #c7d5e0;
                background:#f4f8fb;
                line-height:20px;
            ">${message}</div>
        `;
    }

    function addPayloadField(form) {
        const field = form.addField({
            id: PAYLOAD_FIELD,
            label: 'Shipment Payload',
            type: serverWidget.FieldType.LONGTEXT
        });

        field.updateDisplayType({
            displayType: serverWidget.FieldDisplayType.HIDDEN
        });
    }

    function addFilterFields(form, params) {
        const shipmentNumber = form.addField({
            id: 'custpage_filter_shipment_number',
            label: 'Shipment Number',
            type: serverWidget.FieldType.TEXT
        });
        shipmentNumber.defaultValue = params.custpage_filter_shipment_number || '';

        const snNumber = form.addField({
            id: 'custpage_filter_sn_number',
            label: 'SN Number',
            type: serverWidget.FieldType.TEXT
        });
        snNumber.defaultValue = params.custpage_filter_sn_number || '';

        const containerNumber = form.addField({
            id: 'custpage_filter_container_number',
            label: 'Container Number',
            type: serverWidget.FieldType.TEXT
        });
        containerNumber.defaultValue = params.custpage_filter_container_number || '';

        const expectedFrom = form.addField({
            id: 'custpage_filter_expected_from',
            label: 'Expected Arrival From',
            type: serverWidget.FieldType.DATE
        });
        expectedFrom.defaultValue = params.custpage_filter_expected_from || '';

        const expectedTo = form.addField({
            id: 'custpage_filter_expected_to',
            label: 'Expected Arrival To',
            type: serverWidget.FieldType.DATE
        });
        expectedTo.defaultValue = params.custpage_filter_expected_to || '';
    }

    function getInboundShipments(params) {
        const filters = [];

        const columns = [
    search.createColumn({ name: 'internalid' }),
    search.createColumn({
        name: 'shipmentnumber',
        sort: search.Sort.ASC
    })
];

        const rows = [];
        const shipmentSearch = search.create({
            type: RECORD_TYPE,
            filters,
            columns
        });

shipmentSearch.run().each((result) => {
    if (rows.length >= PAGE_SIZE) {
        return false;
    }

    const shipmentId = String(
        result.getValue({ name: 'internalid' }) || ''
    );

    try {
        const shipmentRecord = record.load({
            type: RECORD_TYPE,
            id: shipmentId,
            isDynamic: false
        });

        const shipmentNumber = String(
    shipmentRecord.getValue({
        fieldId: 'shipmentnumber'
    }) || ''
);

const snNumber = String(
    shipmentRecord.getValue({
        fieldId: 'externaldocumentnumber'
    }) || ''
);

const containerNumber = String(
    shipmentRecord.getValue({
        fieldId: 'vesselnumber'
    }) || ''
);

const expectedArrival = shipmentRecord.getValue({
    fieldId: 'expecteddeliverydate'
});

if (!matchesInboundFilters({
    shipmentNumber: shipmentNumber,
    snNumber: snNumber,
    containerNumber: containerNumber,
    expectedArrival: expectedArrival
}, params)) {
    return true;
}

        const values = {};

        EDITABLE_FIELDS.forEach((field) => {
            let value = '';
            let text = '';

            try {
                value = shipmentRecord.getValue({
                    fieldId: field.id
                });

                if (field.type === 'select') {
                    text = shipmentRecord.getText({
                        fieldId: field.id
                    });
                }
            } catch (fieldError) {
                log.error({
                    title: `Unable to read field ${field.id}`,
                    details: {
                        shipmentId: shipmentId,
                        error: fieldError
                    }
                });
            }

            values[field.id] = {
                value: normalizeRecordValue(value),
                text: normalizeRecordValue(text)
            };
        });

        const shipmentItems = getInboundShipmentItems(
    shipmentRecord
);

rows.push({
    id: shipmentId,
    shipmentNumber: shipmentNumber,
    values: values,
    items: shipmentItems
});
    } catch (recordError) {
        log.error({
            title: `Unable to load inbound shipment ${shipmentId}`,
            details: recordError
        });
    }

    return true;
});

        return rows;
    }
    function getInboundShipmentItems(shipmentRecord) {
    const items = [];
    const lineCount = shipmentRecord.getLineCount({
        sublistId: 'items'
    });

    for (let line = 0; line < lineCount; line += 1) {
        const purchaseOrderId = getSublistValueSafe(
            shipmentRecord,
            'items',
            'purchaseorder',
            line
        );

        const purchaseOrderText =
            getSublistTextSafe(
                shipmentRecord,
                'items',
                'purchaseorder',
                line
            ) ||
            purchaseOrderId;

        const itemId = getSublistValueSafe(
            shipmentRecord,
            'items',
            'shipmentitem',
            line
        );

        const itemText =
            getSublistTextSafe(
                shipmentRecord,
                'items',
                'shipmentitem',
                line
            ) ||
            getSublistValueSafe(
                shipmentRecord,
                'items',
                'shipmentitemtext',
                line
            ) ||
            itemId;

        items.push({
            line: line + 1,

            purchaseOrderId: purchaseOrderId,
            purchaseOrderText: purchaseOrderText,

            vendor: getSublistValueSafe(
                shipmentRecord,
                'items',
                'povendor',
                line
            ),

            itemId: itemId,
            itemText: itemText,

            description: getSublistValueSafe(
                shipmentRecord,
                'items',
                'shipmentitemdescription',
                line
            ),

            receivingLocation:
                getSublistTextSafe(
                    shipmentRecord,
                    'items',
                    'receivinglocation',
                    line
                ) ||
                getSublistValueSafe(
                    shipmentRecord,
                    'items',
                    'receivinglocation',
                    line
                ),

            quantityExpected: getSublistValueSafe(
                shipmentRecord,
                'items',
                'quantityexpected',
                line
            ),

            quantityReceived: getSublistValueSafe(
                shipmentRecord,
                'items',
                'quantityreceived',
                line
            ),

            quantityBilled: getSublistValueSafe(
                shipmentRecord,
                'items',
                'quantitybilled',
                line
            ),

            quantityRemaining: getSublistValueSafe(
                shipmentRecord,
                'items',
                'quantityremaining',
                line
            ),

            poRate: getSublistValueSafe(
                shipmentRecord,
                'items',
                'porate',
                line
            ),

            expectedRate: getSublistValueSafe(
                shipmentRecord,
                'items',
                'expectedrate',
                line
            ),

            amount: getSublistValueSafe(
                shipmentRecord,
                'items',
                'shipmentitemamount',
                line
            ),

            weightCube: getSublistValueSafe(
                shipmentRecord,
                'items',
                'custrecord_is_line_total_weight_cube',
                line
            )
        });
    }

    return items;
}

function getSublistValueSafe(recordObject, sublistId, fieldId, line) {
    try {
        const value = recordObject.getSublistValue({
            sublistId: sublistId,
            fieldId: fieldId,
            line: line
        });

        return value === null || value === undefined
            ? ''
            : value;
    } catch (error) {
        return '';
    }
}

function getSublistTextSafe(recordObject, sublistId, fieldId, line) {
    try {
        const value = recordObject.getSublistText({
            sublistId: sublistId,
            fieldId: fieldId,
            line: line
        });

        return value === null || value === undefined
            ? ''
            : value;
    } catch (error) {
        return '';
    }
}

    function matchesInboundFilters(shipment, params) {
    const shipmentNumberFilter = String(
        params.custpage_filter_shipment_number || ''
    ).trim().toLowerCase();

    const snNumberFilter = String(
        params.custpage_filter_sn_number || ''
    ).trim().toLowerCase();

    const containerNumberFilter = String(
        params.custpage_filter_container_number || ''
    ).trim().toLowerCase();

    if (
        shipmentNumberFilter &&
        String(shipment.shipmentNumber || '')
            .toLowerCase()
            .indexOf(shipmentNumberFilter) === -1
    ) {
        return false;
    }

    if (
        snNumberFilter &&
        String(shipment.snNumber || '')
            .toLowerCase()
            .indexOf(snNumberFilter) === -1
    ) {
        return false;
    }

    if (
        containerNumberFilter &&
        String(shipment.containerNumber || '')
            .toLowerCase()
            .indexOf(containerNumberFilter) === -1
    ) {
        return false;
    }

    const expectedFrom = parseFilterDate(
        params.custpage_filter_expected_from
    );

    const expectedTo = parseFilterDate(
        params.custpage_filter_expected_to
    );

    const expectedArrival =
        shipment.expectedArrival instanceof Date
            ? stripTime(shipment.expectedArrival)
            : null;

    if (
        expectedFrom &&
        (!expectedArrival || expectedArrival < expectedFrom)
    ) {
        return false;
    }

    if (
        expectedTo &&
        (!expectedArrival || expectedArrival > expectedTo)
    ) {
        return false;
    }

    return true;
}

function parseFilterDate(value) {
    if (!value) {
        return null;
    }

    try {
        const parsed = format.parse({
            value: value,
            type: format.Type.DATE
        });

        return stripTime(parsed);
    } catch (error) {
        return null;
    }
}

function stripTime(dateValue) {
    return new Date(
        dateValue.getFullYear(),
        dateValue.getMonth(),
        dateValue.getDate()
    );
}


    function addShipmentGrid(form, shipments) {
        const field = form.addField({
            id: 'custpage_shipments_html',
            label: 'Inbound Shipments',
            type: serverWidget.FieldType.INLINEHTML
        });

        field.updateLayoutType({
            layoutType: serverWidget.FieldLayoutType.OUTSIDEBELOW
        });

        field.updateBreakType({
            breakType: serverWidget.FieldBreakType.STARTROW
        });

        field.defaultValue = buildShipmentHtml(shipments);
    }

    function buildShipmentHtml(shipments) {
        const selectOptions = loadAllSelectOptions();

        const headers = EDITABLE_FIELDS
            .map((field) => `<th>${escapeHtml(field.label)}</th>`)
            .join('');

        const rows = shipments.map((shipment) => {
            const recordUrl = url.resolveRecord({
                recordType: RECORD_TYPE,
                recordId: shipment.id,
                isEditMode: false
            });

            const editableCells = EDITABLE_FIELDS.map((field) => {
                return `
                    <td>
                        ${buildEditor(
                            shipment.id,
                            field,
                            shipment.values[field.id] || { value: '', text: '' },
                            selectOptions[field.id] || []
                        )}
                    </td>
                `;
            }).join('');

const detailRowId =
    `shipment_items_${shipment.id}`;

return `
    <tr class="shipment-row"
        data-shipment-id="${escapeHtml(shipment.id)}">

        <td class="center">
            <button
                type="button"
                class="expand-btn"
                onclick="toggleShipmentItems(
                    '${escapeHtml(detailRowId)}',
                    this
                )">
                +
            </button>
        </td>

        <td class="center">
            <input type="checkbox"
                   class="save-check"
                   data-shipment-id="${escapeHtml(shipment.id)}">
        </td>
                    <td>
                        <a href="${escapeHtml(recordUrl)}" target="_blank">
                            ${escapeHtml(shipment.shipmentNumber)}
                        </a>
                    </td>
${editableCells}
</tr>

<tr id="${escapeHtml(detailRowId)}"
    class="shipment-items-row"
    style="display:none;">

    <td colspan="${EDITABLE_FIELDS.length + 3}">
        ${buildInboundItemsTable(shipment.items || [])}
    </td>
</tr>
`;
        }).join('');

        return `
            <style>
                .shipment-page {
                    width:calc(100vw - 32px);
                    max-width:calc(100vw - 32px);
                    margin:10px 0 0 -6px;
                    box-sizing:border-box;
                    font-family:Arial, Helvetica, sans-serif;
                }

                .shipment-toolbar {
                    display:flex;
                    align-items:center;
                    gap:8px;
                    margin-bottom:8px;
                }

                .shipment-toolbar button {
                    padding:6px 12px;
                    border:1px solid #b5b5b5;
                    border-radius:3px;
                    background:#fff;
                    cursor:pointer;
                    font-size:12px;
                }

                .shipment-note {
                    margin-left:12px;
                    font-size:12px;
                    color:#555;
                }

                .shipment-grid-wrapper {
                    width:100%;
                    max-height:calc(100vh - 315px);
                    overflow:auto;
                    border:1px solid #d7d7d7;
                    background:#fff;
                }

                .shipment-grid {
                    min-width:4300px;
                    border-collapse:collapse;
                    table-layout:auto;
                    font-size:12px;
                }

                .shipment-grid th {
                    position:sticky;
                    top:0;
                    z-index:5;
                    padding:6px 5px;
                    border:1px solid #cfcfcf;
                    background:#f5f5f5;
                    white-space:nowrap;
                    text-align:left;
                }

                .shipment-grid td {
                    padding:4px;
                    border:1px solid #dedede;
                    background:#fff;
                    white-space:nowrap;
                    vertical-align:top;
                }

                .shipment-grid tr:hover td {
                    background:#eef6fb;
                }

                .shipment-grid input[type="text"],
                .shipment-grid input[type="date"],
                .shipment-grid input[type="datetime-local"],
                .shipment-grid select {
                    width:155px;
                    min-width:155px;
                    height:24px;
                    box-sizing:border-box;
                    border:1px solid #b7b7b7;
                    background:#fff;
                    font-size:12px;
                }

                .shipment-grid textarea {
                    width:230px;
                    min-width:230px;
                    height:44px;
                    box-sizing:border-box;
                    border:1px solid #b7b7b7;
                    resize:vertical;
                    font-size:12px;
                }

                .shipment-grid .changed {
                    outline:2px solid #e2a900;
                    background:#fffce8;
                }

                .center {
                    text-align:center;
                }
                .expand-btn {
    width:22px;
    height:22px;
    padding:0;
    border:1px solid #b5b5b5;
    border-radius:2px;
    background:#fff;
    cursor:pointer;
    font-weight:bold;
    line-height:18px;
}

.expand-btn:hover {
    background:#f1f1f1;
}

.shipment-items-row > td {
    background:#fafafa !important;
    padding:8px 12px !important;
}

.inbound-items-wrapper {
    margin-left:28px;
    overflow-x:auto;
    border:1px solid #d7d7d7;
    background:#fff;
}

.inbound-items-table {
    width:100%;
    min-width:1500px;
    border-collapse:collapse;
    font-size:12px;
}

.inbound-items-table th {
    position:static;
    background:#f3f3f3;
    border:1px solid #d0d0d0;
    padding:5px;
    white-space:nowrap;
}

.inbound-items-table td {
    background:#fff !important;
    border:1px solid #e1e1e1;
    padding:5px;
    white-space:nowrap;
}

.inbound-items-table .right {
    text-align:right;
}

.no-items-message {
    margin-left:28px;
    padding:10px;
    border:1px solid #ddd;
    background:#fff;
}

            </style>

            <div class="shipment-page">
                <div class="shipment-toolbar">
                    <button type="button" onclick="markAllShipments()">Mark All</button>
                    <button type="button" onclick="unmarkAllShipments()">Unmark All</button>
                    <button type="button" onclick="applyInboundFilters()">Apply Filters</button>
                    <span class="shipment-note">
                        Showing up to ${PAGE_SIZE} shipments. Edited rows are marked automatically.
                    </span>
                </div>

                <div class="shipment-grid-wrapper">
                    <table class="shipment-grid">
                        <thead>
                            <tr>
<th></th>
<th>Save</th>
<th>Shipment Number</th>
${headers}
                            </tr>
                        </thead>
                        <tbody>
                            ${rows || `
                                <tr>
                                    <td colspan="${EDITABLE_FIELDS.length + 3}"
                                        style="padding:14px;text-align:center;">
                                        No inbound shipments found.
                                    </td>
                                </tr>
                            `}
                        </tbody>
                    </table>
                </div>
            </div>

            ${buildBrowserScript()}
        `;
    }
    function buildInboundItemsTable(items) {
    if (!items.length) {
        return `
            <div class="no-items-message">
                No purchase order lines found for this inbound shipment.
            </div>
        `;
    }

    const rows = items.map((item) => {
        let purchaseOrderDisplay =
            escapeHtml(item.purchaseOrderText);

        if (item.purchaseOrderId) {
            try {
                const purchaseOrderUrl = url.resolveRecord({
                    recordType: record.Type.PURCHASE_ORDER,
                    recordId: item.purchaseOrderId,
                    isEditMode: false
                });

                purchaseOrderDisplay = `
                    <a href="${escapeHtml(purchaseOrderUrl)}"
                       target="_blank">
                        ${escapeHtml(item.purchaseOrderText)}
                    </a>
                `;
            } catch (error) {
                purchaseOrderDisplay =
                    escapeHtml(item.purchaseOrderText);
            }
        }

        let itemDisplay = escapeHtml(item.itemText);

        if (item.itemId) {
            try {
                const itemUrl = url.resolveRecord({
                    recordType: 'inventoryitem',
                    recordId: item.itemId,
                    isEditMode: false
                });

                itemDisplay = `
                    <a href="${escapeHtml(itemUrl)}"
                       target="_blank">
                        ${escapeHtml(item.itemText)}
                    </a>
                `;
            } catch (error) {
                itemDisplay = escapeHtml(item.itemText);
            }
        }

        return `
            <tr>
                <td>${escapeHtml(item.line)}</td>
                <td>${purchaseOrderDisplay}</td>
                <td>${escapeHtml(item.vendor)}</td>
                <td>${itemDisplay}</td>
                <td>${escapeHtml(item.description)}</td>
                <td>${escapeHtml(item.receivingLocation)}</td>
                <td class="right">
                    ${escapeHtml(item.quantityExpected)}
                </td>
                <td class="right">
                    ${escapeHtml(item.quantityReceived)}
                </td>
                <td class="right">
                    ${escapeHtml(item.quantityBilled)}
                </td>
                <td class="right">
                    ${escapeHtml(item.quantityRemaining)}
                </td>
                <td class="right">
                    ${escapeHtml(item.poRate)}
                </td>
                <td class="right">
                    ${escapeHtml(item.expectedRate)}
                </td>
                <td class="right">
                    ${escapeHtml(item.amount)}
                </td>
                <td class="right">
                    ${escapeHtml(item.weightCube)}
                </td>
            </tr>
        `;
    }).join('');

    return `
        <div class="inbound-items-wrapper">
            <table class="inbound-items-table">
                <thead>
                    <tr>
                        <th>Line</th>
                        <th>Purchase Order</th>
                        <th>Vendor</th>
                        <th>Item</th>
                        <th>Description</th>
                        <th>Receiving Location</th>
                        <th>Qty Expected</th>
                        <th>Qty Received</th>
                        <th>Qty Billed</th>
                        <th>Qty Remaining</th>
                        <th>PO Rate</th>
                        <th>Expected Rate</th>
                        <th>Amount</th>
                        <th>Weight / Cube</th>
                    </tr>
                </thead>

                <tbody>
                    ${rows}
                </tbody>
            </table>
        </div>
    `;
}

    function buildEditor(shipmentId, field, fieldData, options) {
        const rawValue = normalizeSearchValue(fieldData.value);
        const displayText = normalizeSearchValue(fieldData.text);

        const common = `
            class="shipment-input"
            data-shipment-id="${escapeHtml(shipmentId)}"
            data-field-id="${escapeHtml(field.id)}"
            data-field-type="${escapeHtml(field.type)}"
            data-original-value="${escapeHtml(getComparableOriginalValue(field, rawValue))}"
        `;

        switch (field.type) {
            case 'checkbox':
                return `
                    <input type="checkbox"
                           ${common}
                           ${rawValue === 'T' || rawValue === true ? 'checked' : ''}>
                `;

            case 'date':
                return `
                    <input type="date"
                           ${common}
                           value="${escapeHtml(toHtmlDate(rawValue))}">
                `;

            case 'datetime':
                return `
                    <input type="datetime-local"
                           ${common}
                           value="${escapeHtml(toHtmlDateTime(rawValue))}">
                `;

            case 'textarea':
                return `<textarea ${common}>${escapeHtml(rawValue)}</textarea>`;

            case 'select':
                if (options.length > 1) {
                    return `
                        <select ${common}>
                            ${buildOptions(options, rawValue)}
                        </select>
                    `;
                }

                return `
                    <input type="text"
                           ${common}
                           value="${escapeHtml(rawValue)}"
                           title="Enter internal ID. Current display value: ${escapeHtml(displayText)}"
                           placeholder="${escapeHtml(displayText || 'Internal ID')}">
                `;

            default:
                return `
                    <input type="text"
                           ${common}
                           value="${escapeHtml(rawValue)}">
                `;
        }
    }

    function getComparableOriginalValue(field, rawValue) {
        if (field.type === 'date') {
            return toHtmlDate(rawValue);
        }

        if (field.type === 'datetime') {
            return toHtmlDateTime(rawValue);
        }

        if (field.type === 'checkbox') {
            return rawValue === 'T' || rawValue === true ? 'T' : 'F';
        }

        return String(rawValue || '');
    }

    function loadAllSelectOptions() {
        const result = {};

        Object.keys(SELECT_SOURCES).forEach((fieldId) => {
            result[fieldId] = loadSelectOptions(SELECT_SOURCES[fieldId]);
        });

        return result;
    }

    function loadSelectOptions(sourceType) {
        const options = [{ id: '', text: '' }];

        if (!sourceType) {
            return options;
        }

        try {
            search.create({
                type: sourceType,
                filters: [['isinactive', 'is', 'F']],
                columns: [
                    search.createColumn({ name: 'name', sort: search.Sort.ASC }),
                    search.createColumn({ name: 'internalid' })
                ]
            }).run().each((result) => {
                options.push({
                    id: String(result.getValue({ name: 'internalid' }) || ''),
                    text: String(result.getValue({ name: 'name' }) || '')
                });
                return true;
            });
        } catch (error) {
            log.error({
                title: `Unable to load select source ${sourceType}`,
                details: error
            });
        }

        return options;
    }

    function buildOptions(options, selectedValue) {
        return options.map((option) => {
            const selected =
                String(option.id) === String(selectedValue) ? ' selected' : '';

            return `
                <option value="${escapeHtml(option.id)}"${selected}>
                    ${escapeHtml(option.text)}
                </option>
            `;
        }).join('');
    }

    function buildBrowserScript() {
        return `
            <script>
            function createNewInboundShipment() {
    window.open(
        '/app/accounting/transactions/shipping/inboundshipment/inboundshipment.nl',
        '_blank',
        'noopener,noreferrer'
    );
}
            function toggleShipmentItems(rowId, button) {
    var detailRow = document.getElementById(rowId);

    if (!detailRow) {
        return;
    }

    var isHidden =
        detailRow.style.display === 'none' ||
        detailRow.style.display === '';

    detailRow.style.display =
        isHidden ? 'table-row' : 'none';

    button.textContent =
        isHidden ? '-' : '+';
}
        
                function markAllShipments() {
                    document.querySelectorAll('.save-check').forEach(function (checkbox) {
                        checkbox.checked = true;
                    });
                }

                function unmarkAllShipments() {
                    document.querySelectorAll('.save-check').forEach(function (checkbox) {
                        checkbox.checked = false;
                    });
                }

                function applyInboundFilters() {
                    var target = new URL(window.location.href);
                    var fields = [
                        'custpage_filter_shipment_number',
                        'custpage_filter_sn_number',
                        'custpage_filter_container_number',
                        'custpage_filter_expected_from',
                        'custpage_filter_expected_to'
                    ];

                    fields.forEach(function (fieldId) {
                        var field = document.getElementById(fieldId);

                        if (field && field.value) {
                            target.searchParams.set(fieldId, field.value);
                        } else {
                            target.searchParams.delete(fieldId);
                        }
                    });

                    window.location.href = target.toString();
                }

                function getInputValue(input) {
                    if (input.type === 'checkbox') {
                        return input.checked ? 'T' : 'F';
                    }

                    return input.value || '';
                }

                document.addEventListener('change', function (event) {
                    var input = event.target;

                    if (!input.classList.contains('shipment-input')) {
                        return;
                    }

                    var currentValue = getInputValue(input);
                    var originalValue = input.getAttribute('data-original-value') || '';

                    input.classList.toggle('changed', currentValue !== originalValue);

                    var shipmentId = input.getAttribute('data-shipment-id');
                    var selector =
                        '.save-check[data-shipment-id="' + shipmentId + '"]';
                    var saveCheckbox = document.querySelector(selector);

                    if (saveCheckbox) {
                        saveCheckbox.checked = true;
                    }
                });

                document.addEventListener('submit', function (event) {
                    var payload = [];

                    document.querySelectorAll('.save-check:checked')
                        .forEach(function (saveCheckbox) {
                            var shipmentId =
                                saveCheckbox.getAttribute('data-shipment-id');
                            var rowSelector =
                                '.shipment-row[data-shipment-id="' + shipmentId + '"]';
                            var row = document.querySelector(rowSelector);
                            var values = {};

                            if (!row) {
                                return;
                            }

                            row.querySelectorAll('.shipment-input')
                                .forEach(function (input) {
                                    values[input.getAttribute('data-field-id')] =
                                        getInputValue(input);
                                });

payload.push({
    id: shipmentId,
    values: values
});
                        });

                    var payloadField =
                        document.getElementById('${PAYLOAD_FIELD}');

                    if (payloadField) {
                        payloadField.value = JSON.stringify(payload);
                    }

                    if (!payload.length) {
                        event.preventDefault();
                        alert('Select or edit at least one inbound shipment.');
                    }
                });
            </script>
        `;
    }

    function processUpdates(context) {
        const rawPayload = context.request.parameters[PAYLOAD_FIELD] || '[]';
        let updates;

        try {
            updates = JSON.parse(rawPayload);
        } catch (error) {
            renderForm(context, 'The submitted shipment payload is invalid.');
            return;
        }

        if (!Array.isArray(updates) || !updates.length) {
            renderForm(context, 'No inbound shipments were selected.');
            return;
        }

        const messages = [];

        updates.forEach((update) => {
            try {
                updateInboundShipment(update);
                messages.push(
                    `<span style="color:#167b2c;">Shipment ${escapeHtml(update.id)} saved.</span>`
                );
            } catch (error) {
                log.error({
                    title: `Inbound shipment update failed: ${update.id}`,
                    details: error
                });

                messages.push(
                    `<span style="color:#b42318;">Shipment ${escapeHtml(update.id)} failed: ` +
                    `${escapeHtml(error.message || String(error))}</span>`
                );
            }
        });

        renderForm(context, messages.join('<br>'));
    }

    function updateInboundShipment(update) {
        if (!update || !update.id) {
            throw new Error('Inbound shipment internal ID is missing.');
        }


        const shipment = record.load({
            type: RECORD_TYPE,
            id: update.id,
            isDynamic: false
        });

        EDITABLE_FIELDS.forEach((field) => {
            if (
                !update.values ||
                !Object.prototype.hasOwnProperty.call(update.values, field.id)
            ) {
                return;
            }

            shipment.setValue({
                fieldId: field.id,
                value: normalizeFieldValue(field, update.values[field.id])
            });
        });

        shipment.save({
            enableSourcing: true,
            ignoreMandatoryFields: false
        });
    }

    function normalizeFieldValue(field, rawValue) {
        switch (field.type) {
            case 'checkbox':
                return rawValue === 'T' || rawValue === true;

            case 'date':
                return rawValue ? parseIsoDate(String(rawValue)) : null;

            case 'datetime':
                return rawValue ? parseIsoDateTime(String(rawValue)) : null;

            case 'select':
                return rawValue ? String(rawValue) : '';

            default:
                return rawValue === null || rawValue === undefined
                    ? ''
                    : String(rawValue);
        }
    }

    function parseIsoDate(value) {
        const parts = value.split('-');

        if (parts.length !== 3) {
            throw new Error(`Invalid date: ${value}`);
        }

        const parsed = new Date(
            Number(parts[0]),
            Number(parts[1]) - 1,
            Number(parts[2])
        );

        if (Number.isNaN(parsed.getTime())) {
            throw new Error(`Invalid date: ${value}`);
        }

        return parsed;
    }

    function parseIsoDateTime(value) {
        const parsed = new Date(value);

        if (Number.isNaN(parsed.getTime())) {
            throw new Error(`Invalid date/time: ${value}`);
        }

        return parsed;
    }

    function toHtmlDate(netSuiteValue) {
        if (!netSuiteValue) {
            return '';
        }

        try {
            const parsed = format.parse({
                value: netSuiteValue,
                type: format.Type.DATE
            });

            return [
                parsed.getFullYear(),
                String(parsed.getMonth() + 1).padStart(2, '0'),
                String(parsed.getDate()).padStart(2, '0')
            ].join('-');
        } catch (error) {
            return '';
        }
    }

    function toHtmlDateTime(netSuiteValue) {
        if (!netSuiteValue) {
            return '';
        }

        const types = [format.Type.DATETIMETZ, format.Type.DATETIME];

        for (let index = 0; index < types.length; index += 1) {
            try {
                const parsed = format.parse({
                    value: netSuiteValue,
                    type: types[index]
                });

                return [
                    parsed.getFullYear(),
                    '-',
                    String(parsed.getMonth() + 1).padStart(2, '0'),
                    '-',
                    String(parsed.getDate()).padStart(2, '0'),
                    'T',
                    String(parsed.getHours()).padStart(2, '0'),
                    ':',
                    String(parsed.getMinutes()).padStart(2, '0')
                ].join('');
            } catch (error) {
                // Try the next supported datetime format.
            }
        }

        return '';
    }

    function normalizeSearchValue(value) {
        if (value === null || value === undefined) {
            return '';
        }

        return value;
    }

    function normalizeRecordValue(value) {
    if (value === null || value === undefined) {
        return '';
    }

    if (value instanceof Date) {
        return value;
    }

    return value;
}

    function escapeHtml(value) {
        return String(value === null || value === undefined ? '' : value)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#039;');
    }

    return {
        onRequest
    };
});
