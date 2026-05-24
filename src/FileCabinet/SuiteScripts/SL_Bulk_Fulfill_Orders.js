/**
 * @NApiVersion 2.1
 * @NScriptType Suitelet
 */
define([
    'N/ui/serverWidget',
    'N/search',
    'N/record',
    'N/runtime',
    'N/redirect',
    'N/format',
    'N/log'
], (
    serverWidget,
    search,
    record,
    runtime,
    redirect,
    format,
    log
) => {

    const SUBLIST_ID = 'custpage_orders';

    const FLD_SELECT = 'custpage_select';
    const FLD_SO_ID = 'custpage_so_id';
    const FLD_TRANID = 'custpage_tranid';
    const FLD_CUSTOMER = 'custpage_customer';
    const FLD_DATE = 'custpage_date';
    const FLD_MEMO = 'custpage_memo';
    const FLD_CURRENCY = 'custpage_currency';
    const FLD_STATUS = 'custpage_status';
  const FLD_ZONE = 'custpage_zone';
const FLD_CREATED_DATE = 'custpage_created_date';
const FLD_SHIP_DATE = 'custpage_ship_date';
const FLD_PO = 'custpage_po';
const FLD_ITEMS = 'custpage_items';
const FLD_LINE_DRIVER = 'custpage_line_driver';
const FLD_LINE_TRUCK = 'custpage_line_truck';

    const PAGE_SIZE = 500;

    function onRequest(context) {
        if (context.request.method === 'GET') {
            renderForm(context);
        } else {
            processFulfillments(context);
        }
    }

    function renderForm(context, message) {
        const request = context.request;
        const params = request.parameters || {};

        const form = serverWidget.createForm({
    title: 'Simplex Fulfill Orders'
});
        form.addSubmitButton({
            label: 'Submit'
        });

        if (message) {
            const msgField = form.addField({
                id: 'custpage_message',
                label: 'Message',
                type: serverWidget.FieldType.INLINEHTML
            });

            msgField.defaultValue = `
                <div style="padding:10px;margin-bottom:12px;border:1px solid #c7d5e0;background:#f4f8fb;">
                    ${escapeHtml(message)}
                </div>
            `;
        }

        const payloadFld = form.addField({
    id: 'custpage_fulfillment_payload',
    label: 'Fulfillment Payload',
    type: serverWidget.FieldType.LONGTEXT
});

payloadFld.updateDisplayType({
    displayType: serverWidget.FieldDisplayType.HIDDEN
});
      addFilterFields(form, params);
        addOrdersHtmlTable(form, params);

        context.response.writePage(form);
    }
  
function addOrdersHtmlTable(form, params) {
    log.debug({
        title: 'Suitelet Filter Params',
        details: JSON.stringify(params)
    });

    const orders = getEligibleSalesOrders(params);

    const htmlFld = form.addField({
        id: 'custpage_orders_html',
        label: 'Orders',
        type: serverWidget.FieldType.INLINEHTML
    });

    /*
     * This is the important part.
     * It forces the custom HTML table outside NetSuite's normal two-column field layout.
     */
    htmlFld.updateLayoutType({
        layoutType: serverWidget.FieldLayoutType.OUTSIDEBELOW
    });

    htmlFld.updateBreakType({
        breakType: serverWidget.FieldBreakType.STARTROW
    });

    htmlFld.defaultValue = buildOrdersHtml(orders, params);
}

  function buildOrdersHtml(orders, params) {
    const driverOptions = [
    { id: '', name: '' },
    { id: '1', name: 'Picker 1' },
    { id: '2', name: 'Picker 2' },
    { id: '3', name: 'Picker 3' },
    { id: '101', name: 'Picker 4' },
    { id: '102', name: 'Picker 5' },
    { id: '103', name: 'Picker 6' }
];

    const truckOptions = [
    { id: '', name: '' },
    { id: '1', name: 'Truck 1' },
    { id: '101', name: 'Truck 2' },
    { id: '102', name: 'Truck 3' },
    { id: '103', name: 'Truck 4' },
    { id: '104', name: 'Truck 5' },
    { id: '105', name: 'Truck 6' },
    { id: '106', name: 'Truck 7' },
    { id: '107', name: 'Truck 8' },
    { id: '108', name: 'Truck 9' },
    { id: '109', name: 'Truck 10' }
];

    let rowsHtml = '';

    if (!orders.length) {
        rowsHtml = `
            <tr>
                <td colspan="11" style="text-align:center;padding:14px;">
                    No records to show.
                </td>
            </tr>
        `;
    } else {
        orders.forEach((order, index) => {
            const rowId = `order_items_${order.id}`;

            rowsHtml += `
    <tr class="order-row" data-soid="${escapeHtml(order.id)}">
        <td class="center">
            <button type="button" class="expand-btn" onclick="toggleItems('${rowId}', this)">+</button>
        </td>
        <td class="center">
            <input type="checkbox" class="fulfill-check" data-soid="${escapeHtml(order.id)}">
        </td>
        <td>${escapeHtml(order.tranid)}</td>
        <td>${escapeHtml(order.customer)}</td>
        <td>${escapeHtml(order.trandate)}</td>
        <td>${escapeHtml(order.shipdate)}</td>
        <td>${escapeHtml(order.zone)}</td>
        <td>${escapeHtml(order.enteredBy)}</td>
        <td>${escapeHtml(order.createdDate)}</td>
        <td>
            <select class="line-driver" data-soid="${escapeHtml(order.id)}">
                ${buildSelectOptions(driverOptions, '')}
            </select>
        </td>
        <td>
            <select class="line-truck" data-soid="${escapeHtml(order.id)}">
                ${buildSelectOptions(truckOptions, '')}
            </select>
        </td>
    </tr>

    <tr id="${rowId}" class="items-row" style="display:none;">
        <td colspan="11">
            ${buildItemsTable(order.items || [])}
        </td>
    </tr>
`;
        });
    }

    return `
        <style>
    .delivery-page {
        width: calc(100vw - 32px);
        max-width: calc(100vw - 32px);
        margin-left: -6px;
        margin-top: 8px;
        box-sizing: border-box;
        font-family: Arial, Helvetica, sans-serif;
    }

    .delivery-toolbar {
        margin-top: 8px;
        margin-bottom: 8px;
        display: flex;
        gap: 8px;
        align-items: center;
    }

    .delivery-toolbar button {
        padding: 6px 12px;
        border: 1px solid #b5b5b5;
        background: #ffffff;
        cursor: pointer;
        border-radius: 3px;
        color: #222222;
        font-size: 12px;
    }

    .delivery-toolbar button:hover {
        background: #f4f4f4;
    }

    .delivery-table-wrapper {
        width: 100%;
        max-width: 100%;
        min-height: calc(100vh - 330px);
        overflow-x: auto;
        overflow-y: auto;
        padding-bottom: 16px;
        box-sizing: border-box;
        border: 1px solid #d7d7d7;
        background: #ffffff;
    }

    .delivery-table {
        width: 100%;
        min-width: 1250px;
        border-collapse: collapse;
        font-size: 12px;
        table-layout: auto;
        background: #ffffff;
    }

    .delivery-table th {
        background: #f5f5f5;
        color: #222222;
        border: 1px solid #d0d0d0;
        border-bottom: 1px solid #bcbcbc;
        padding: 6px 5px;
        text-align: left;
        white-space: nowrap;
        font-weight: 600;
    }

    .delivery-table td {
        background: #ffffff;
        border: 1px solid #e1e1e1;
        padding: 5px 4px;
        vertical-align: top;
        white-space: nowrap;
        color: #222222;
    }

    .delivery-table tr.order-row:nth-child(4n+1) td {
        background: #ffffff;
    }

    .delivery-table tr.order-row:nth-child(4n+3) td {
        background: #fafafa;
    }

    .delivery-table tr.order-row:hover td {
        background: #eef6fb;
    }

    .items-row td {
        background: #fbfbfb !important;
    }

    .items-table {
        width: calc(100% - 30px);
        border-collapse: collapse;
        margin: 6px 0 10px 30px;
        font-size: 12px;
        background: #ffffff;
        border: 1px solid #d8d8d8;
    }

    .items-table th {
        background: #f7f7f7;
        color: #222222;
        border: 1px solid #d0d0d0;
        padding: 5px 4px;
        white-space: nowrap;
        font-weight: 600;
    }

    .items-table td {
        background: #ffffff;
        border: 1px solid #e1e1e1;
        padding: 5px 4px;
        white-space: nowrap;
    }

    .center {
        text-align: center;
    }

    .expand-btn {
        width: 22px;
        height: 22px;
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

    .fulfill-check {
        cursor: pointer;
    }

    .line-driver,
    .line-truck {
        width: 150px;
        background: #ffffff;
        border: 1px solid #b5b5b5;
        height: 23px;
    }
</style>

<div class="delivery-page">
    <div class="delivery-toolbar">
        <button type="button" onclick="markAllCustom()">Mark All</button>
        <button type="button" onclick="unmarkAllCustom()">Unmark All</button>
        <button type="button" onclick="applyFiltersCustom()">Apply Filters</button>
    </div>

    <div class="delivery-table-wrapper">
        <table class="delivery-table">
            <thead>
                <tr>
                    <th></th>
                    <th>Fulfill</th>
                    <th>Order #</th>
                    <th>Customer Name</th>
                    <th>Order Date</th>
<th>Ship Date</th>
<th>Truck Stop Zone</th>
<th>Entered By</th>
<th>Date/Time Entered</th>
<th>Picker</th>
<th>Truck</th>
                </tr>
            </thead>
            <tbody>
                ${rowsHtml}
            </tbody>
        </table>
</div>
</div>
        <script>
            function toggleItems(rowId, button) {
                var row = document.getElementById(rowId);

                if (!row) {
                    return;
                }

                if (row.style.display === 'none') {
                    row.style.display = '';
                    button.innerHTML = '-';
                } else {
                    row.style.display = 'none';
                    button.innerHTML = '+';
                }
            }

            function markAllCustom() {
                document.querySelectorAll('.fulfill-check').forEach(function(cb) {
                    cb.checked = true;
                });
            }

            function unmarkAllCustom() {
                document.querySelectorAll('.fulfill-check').forEach(function(cb) {
                    cb.checked = false;
                });
            }

            function setUrlParam(url, fieldId) {
                var fld = document.getElementById(fieldId);
                if (fld) {
                    url.searchParams.set(fieldId, fld.value || '');
                }
            }

            document.addEventListener('submit', function() {
                var payload = [];

                document.querySelectorAll('.fulfill-check:checked').forEach(function(cb) {
                    var soId = cb.getAttribute('data-soid');

                    var driver = document.querySelector('.line-driver[data-soid="' + soId + '"]');
                    var truck = document.querySelector('.line-truck[data-soid="' + soId + '"]');

                    payload.push({
                        soId: soId,
                        truckDriver: driver ? driver.value : '',
                        truck: truck ? truck.value : ''
                    });
                });

                var payloadField = document.getElementById('custpage_fulfillment_payload');

                if (payloadField) {
                    payloadField.value = JSON.stringify(payload);
                }
            });
        </script>
    `;
}

  function buildSelectOptions(options, selectedValue) {
    return options.map(option => {
        const selected = String(option.id) === String(selectedValue || '') ? 'selected' : '';

        return `
            <option value="${escapeHtml(option.id)}" ${selected}>
                ${escapeHtml(option.name)}
            </option>
        `;
    }).join('');
}

function buildItemsTable(items) {
    if (!items.length) {
        return `
            <div style="padding:8px;">
                No item lines found.
            </div>
        `;
    }

    const itemRows = items.map(line => {
        return `
            <tr>
                <td>${escapeHtml(line.line)}</td>
                <td>${escapeHtml(line.item)}</td>
                <td>${escapeHtml(line.description)}</td>
                <td>${escapeHtml(line.description2)}</td>
                <td class="center">${escapeHtml(line.orderQty)}</td>
                <td class="center">${escapeHtml(line.shipQty)}</td>
                <td>${escapeHtml(line.unit)}</td>
                <td>${escapeHtml(line.unitPrice)}</td>
                <td>${escapeHtml(line.extended)}</td>
                <td>${escapeHtml(line.vendorPo)}</td>
                <td>${escapeHtml(line.extWeight)}</td>
                <td>${escapeHtml(line.gpPercent)}</td>
                <td>${escapeHtml(line.unitCost)}</td>
            </tr>
        `;
    }).join('');

    return `
        <table class="items-table">
            <thead>
                <tr>
                    <th>Line</th>
                    <th>Item</th>
                    <th>Desc 1</th>
                    <th>Desc 2</th>
                    <th>Order Qty</th>
                    <th>Ship Qty</th>
                    <th>UM</th>
                    <th>Unit Price</th>
                    <th>Extended</th>
                    <th>Vendor PO</th>
                    <th>Ext Weight</th>
                    <th>GP%</th>
                    <th>Unit Cost</th>
                </tr>
            </thead>
            <tbody>
                ${itemRows}
            </tbody>
        </table>
    `;
}
  
    function addFilterFields(form, params) {
    const customerFld = form.addField({
    id: 'custpage_customer_filter',
    label: 'Customer',
    type: serverWidget.FieldType.SELECT,
    source: 'customer'
});
customerFld.updateLayoutType({
    layoutType: serverWidget.FieldLayoutType.STARTROW
});
customerFld.defaultValue = params.custpage_customer_filter || '';

const dateFld = form.addField({
    id: 'custpage_fulfillment_date',
    label: 'Fulfillment Date',
    type: serverWidget.FieldType.DATE
});
dateFld.updateLayoutType({
    layoutType: serverWidget.FieldLayoutType.MIDROW
});
dateFld.defaultValue = params.custpage_fulfillment_date || getTodayString();

const shipStatusFld = form.addField({
    id: 'custpage_shipstatus',
    label: 'Set Shipment Status To',
    type: serverWidget.FieldType.SELECT
});
shipStatusFld.updateLayoutType({
    layoutType: serverWidget.FieldLayoutType.MIDROW
});

shipStatusFld.addSelectOption({
    value: 'A',
    text: 'Picked'
});
shipStatusFld.addSelectOption({
    value: 'B',
    text: 'Packed'
});
shipStatusFld.addSelectOption({
    value: 'C',
    text: 'Shipped'
});
shipStatusFld.defaultValue = params.custpage_shipstatus || 'A';

const zoneFld = form.addField({
    id: 'custpage_zone_filter',
    label: 'Zone',
    type: serverWidget.FieldType.SELECT
});
zoneFld.updateLayoutType({
    layoutType: serverWidget.FieldLayoutType.ENDROW
});

zoneFld.addSelectOption({
    value: '',
    text: '- All -'
});

getZoneOptions().forEach(zone => {
    zoneFld.addSelectOption({
        value: zone.id,
        text: zone.text
    });
});
zoneFld.defaultValue = params.custpage_zone_filter || '';

const createdFromFld = form.addField({
    id: 'custpage_created_from',
    label: 'Created From',
    type: serverWidget.FieldType.DATE
});
createdFromFld.updateLayoutType({
    layoutType: serverWidget.FieldLayoutType.STARTROW
});
createdFromFld.defaultValue = params.custpage_created_from || '';

const createdToFld = form.addField({
    id: 'custpage_created_to',
    label: 'Created To',
    type: serverWidget.FieldType.DATE
});
createdToFld.updateLayoutType({
    layoutType: serverWidget.FieldLayoutType.MIDROW
});
createdToFld.defaultValue = params.custpage_created_to || '';
const sortDirFld = form.addField({
    id: 'custpage_created_sort',
    label: 'Date/Time Entered Sort',
    type: serverWidget.FieldType.SELECT
});

sortDirFld.updateLayoutType({
    layoutType: serverWidget.FieldLayoutType.MIDROW
});

sortDirFld.addSelectOption({
    value: 'ASC',
    text: 'Ascending'
});

sortDirFld.addSelectOption({
    value: 'DESC',
    text: 'Descending'
});

sortDirFld.defaultValue = params.custpage_created_sort || 'ASC';
    form.addButton({
        id: 'custpage_apply_filters',
        label: 'Apply Filters',
        functionName: 'applyFiltersCustom'
    });
      const availabilityFld = form.addField({
    id: 'custpage_availability_filter',
    label: 'Availability Filter',
    type: serverWidget.FieldType.SELECT
});

availabilityFld.updateLayoutType({
    layoutType: serverWidget.FieldLayoutType.MIDROW
});

availabilityFld.addSelectOption({
    value: 'IGNORE',
    text: 'Ignore Item Availability'
});

availabilityFld.addSelectOption({
    value: 'SOME_COMMITTED',
    text: 'Some Items Committed'
});

availabilityFld.addSelectOption({
    value: 'ALL_FULLY_COMMITTED',
    text: 'All Items Fully Committed'
});

availabilityFld.addSelectOption({
    value: 'ANY_OPEN',
    text: 'Any Open Quantity'
});

availabilityFld.defaultValue = params.custpage_availability_filter || 'SOME_COMMITTED';
      
    form.addField({
    id: 'custpage_filter_script',
    label: ' ',
    type: serverWidget.FieldType.INLINEHTML
}).defaultValue = `
<style>
    #custpage_customer_filter,
    #custpage_fulfillment_date,
    #custpage_shipstatus,
    #custpage_zone_filter,
    #custpage_created_from,
    #custpage_created_to,
    #custpage_created_sort,
    #custpage_availability_filter {
        max-width: 220px;
    }
</style>
    <script>
        function applyFiltersCustom() {
            var baseUrl = window.location.href.split('?')[0];
            var currentUrl = new URL(window.location.href);
            var newUrl = new URL(baseUrl);

            // Preserve NetSuite script/deployment params.
            ['script', 'deploy', 'compid', 'whence'].forEach(function(param) {
                if (currentUrl.searchParams.has(param)) {
                    newUrl.searchParams.set(param, currentUrl.searchParams.get(param));
                }
            });

            setSuiteletUrlParam(newUrl, 'custpage_customer_filter');
setSuiteletUrlParam(newUrl, 'custpage_fulfillment_date');
setSuiteletUrlParam(newUrl, 'custpage_shipstatus');
setSuiteletUrlParam(newUrl, 'custpage_zone_filter');
setSuiteletUrlParam(newUrl, 'custpage_created_from');
setSuiteletUrlParam(newUrl, 'custpage_created_to');
setSuiteletUrlParam(newUrl, 'custpage_created_sort');
setSuiteletUrlParam(newUrl, 'custpage_availability_filter');

            // Prevent NetSuite/browser dirty-page warning.
            window.onbeforeunload = null;

            if (typeof NS !== 'undefined' && NS.form && NS.form.setChanged) {
                NS.form.setChanged(false);
            }

            window.location.href = newUrl.toString();
        }

        function setSuiteletUrlParam(url, fieldId) {
    var value = '';

    try {
        if (typeof nlapiGetFieldValue === 'function') {
            value = nlapiGetFieldValue(fieldId) || '';
        }
    } catch (e) {
        value = '';
    }

    if (!value) {
        var fld = document.getElementById(fieldId);
        if (fld) {
            value = fld.value || '';
        }
    }

    if (value) {
        url.searchParams.set(fieldId, value);
    } else {
        url.searchParams.delete(fieldId);
    }
}
    </script>
`;
}
  function getZoneOptions() {
    const zones = {};
    const results = [];

    const customerSearch = search.create({
        type: search.Type.CUSTOMER,
        filters: [
            ['isinactive', 'is', 'F'],
            'AND',
            ['custentity_zone', 'noneof', '@NONE@']
        ],
        columns: [
            search.createColumn({
                name: 'custentity_zone',
                sort: search.Sort.ASC
            })
        ]
    });

    customerSearch.run().each(result => {
        const id = result.getValue({
            name: 'custentity_zone'
        });

        const text = result.getText({
            name: 'custentity_zone'
        });

        if (id && !zones[id]) {
            zones[id] = true;

            results.push({
                id,
                text: text || id
            });
        }

        return true;
    });

    return results;
}

    function addOrdersSublist(form, params) {
    const sublist = form.addSublist({
        id: SUBLIST_ID,
        label: 'Orders',
        type: serverWidget.SublistType.LIST
    });

    sublist.addField({
        id: FLD_SELECT,
        label: 'Fulfill',
        type: serverWidget.FieldType.CHECKBOX
    });

    sublist.addField({
        id: FLD_SO_ID,
        label: 'Internal ID',
        type: serverWidget.FieldType.TEXT
    }).updateDisplayType({
        displayType: serverWidget.FieldDisplayType.HIDDEN
    });

    sublist.addField({
        id: FLD_TRANID,
        label: 'Order #',
        type: serverWidget.FieldType.TEXT
    });

    sublist.addField({
        id: FLD_STATUS,
        label: 'Status',
        type: serverWidget.FieldType.TEXT
    });

    sublist.addField({
        id: FLD_PO,
        label: 'PO #',
        type: serverWidget.FieldType.TEXT
    });

    sublist.addField({
        id: FLD_DATE,
        label: 'Order Date',
        type: serverWidget.FieldType.TEXT
    });

    sublist.addField({
        id: FLD_SHIP_DATE,
        label: 'Ship Date',
        type: serverWidget.FieldType.TEXT
    });

    sublist.addField({
        id: FLD_ZONE,
        label: 'Zone',
        type: serverWidget.FieldType.TEXT
    });

    sublist.addField({
        id: FLD_CUSTOMER,
        label: 'Customer Name',
        type: serverWidget.FieldType.TEXT
    });

    sublist.addField({
        id: FLD_ITEMS,
        label: 'Items',
        type: serverWidget.FieldType.TEXTAREA
    });

    sublist.addField({
        id: FLD_CREATED_DATE,
        label: 'Entered Date/Time',
        type: serverWidget.FieldType.TEXT
    });

    const driverFld = sublist.addField({
        id: FLD_LINE_DRIVER,
        label: 'Picker / Driver',
        type: serverWidget.FieldType.SELECT
    });

    driverFld.addSelectOption({
        value: '',
        text: ''
    });

    driverFld.addSelectOption({
        value: '1',
        text: 'Driver 1'
    });

    driverFld.addSelectOption({
        value: '2',
        text: 'Driver 2'
    });

    driverFld.addSelectOption({
        value: '3',
        text: 'Driver 3'
    });

    const truckFld = sublist.addField({
        id: FLD_LINE_TRUCK,
        label: 'Truck',
        type: serverWidget.FieldType.SELECT
    });

    truckFld.addSelectOption({
        value: '',
        text: ''
    });

    truckFld.addSelectOption({
        value: '1',
        text: 'ABC 123'
    });

    sublist.addField({
        id: FLD_MEMO,
        label: 'Memo',
        type: serverWidget.FieldType.TEXT
    });

    sublist.addField({
        id: FLD_CURRENCY,
        label: 'Currency',
        type: serverWidget.FieldType.TEXT
    });
log.debug({
    title: 'Suitelet Filter Params',
    details: JSON.stringify(params)
});
    const orders = getEligibleSalesOrders(params);

    if (!orders.length) {
        return;
    }

    orders.forEach((order, index) => {
        setSublistValueSafe(sublist, FLD_SO_ID, index, String(order.id));
        setSublistValueSafe(sublist, FLD_TRANID, index, order.tranid);
        setSublistValueSafe(sublist, FLD_STATUS, index, order.status);
        setSublistValueSafe(sublist, FLD_PO, index, order.po);
        setSublistValueSafe(sublist, FLD_DATE, index, order.trandate);
        setSublistValueSafe(sublist, FLD_SHIP_DATE, index, order.shipdate);
        setSublistValueSafe(sublist, FLD_ZONE, index, order.zone);
        setSublistValueSafe(sublist, FLD_CUSTOMER, index, order.customer);
        setSublistValueSafe(sublist, FLD_ITEMS, index, order.items);
        setSublistValueSafe(sublist, FLD_CREATED_DATE, index, order.createdDate);
        setSublistValueSafe(sublist, FLD_MEMO, index, order.memo);
        setSublistValueSafe(sublist, FLD_CURRENCY, index, order.currency);
    });
}
  
function setSublistValueSafe(sublist, fieldId, line, value) {
    if (value !== null && value !== undefined && value !== '') {
        sublist.setSublistValue({
            id: fieldId,
            line,
            value: String(value)
        });
    }
}
  
    function getEligibleSalesOrders(params) {
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
    ['quantity', 'greaterthan', '0'],
    'AND',
    ['status', 'noneof', [
        'SalesOrd:C',
        'SalesOrd:G',
        'SalesOrd:H'
    ]]
];

      const availabilityFilter = params.custpage_availability_filter || 'SOME_COMMITTED';

if (availabilityFilter === 'IGNORE') {
    // No committed quantity filter.
    // This shows open SO lines even if NetSuite has not committed inventory.
    filters.push(
        'AND',
        ['formulanumeric: NVL({quantity},0) - NVL({quantityshiprecv},0)', 'greaterthan', '0']
    );
}

if (availabilityFilter === 'SOME_COMMITTED') {
    filters.push(
        'AND',
        ['formulanumeric: NVL({quantity},0) - NVL({quantityshiprecv},0)', 'greaterthan', '0'],
        'AND',
        ['quantitycommitted', 'greaterthan', '0']
    );
}

if (availabilityFilter === 'ANY_OPEN') {
    filters.push(
        'AND',
        ['formulanumeric: NVL({quantity},0) - NVL({quantityshiprecv},0)', 'greaterthan', '0']
    );
}

if (availabilityFilter === 'ALL_FULLY_COMMITTED') {
    /*
     * Initial line-level filter:
     * only lines where remaining qty is fully committed.
     *
     * We will do an order-level validation after the grouped search
     * to make sure every fulfillable line on the order is fully committed.
     */
    filters.push(
        'AND',
        [
            'formulanumeric: CASE WHEN NVL({quantity},0) - NVL({quantityshiprecv},0) > 0 AND NVL({quantitycommitted},0) >= NVL({quantity},0) - NVL({quantityshiprecv},0) THEN 1 ELSE 0 END',
            'equalto',
            '1'
        ]
    );
}
      
    if (params.custpage_customer_filter) {
        filters.push('AND', ['entity', 'anyof', params.custpage_customer_filter]);
    }
    if (params.custpage_zone_filter) {
    filters.push('AND', ['customer.custentity_zone', 'anyof', params.custpage_zone_filter]);
}

if (params.custpage_created_from) {
    filters.push('AND', ['datecreated', 'onorafter', params.custpage_created_from]);
}

if (params.custpage_created_to) {
    filters.push('AND', ['datecreated', 'onorbefore', params.custpage_created_to]);
}

const zoneColumn = search.createColumn({
    name: 'formulatext',
    formula: '{customer.custentity_zone}',
    summary: search.Summary.GROUP
});

const createdDateSort =
    params.custpage_created_sort === 'DESC'
        ? search.Sort.DESC
        : search.Sort.ASC;

const createdDateColumn = search.createColumn({
    name: 'datecreated',
    summary: search.Summary.GROUP,
    sort: createdDateSort
});

const internalIdColumn = search.createColumn({
    name: 'internalid',
    summary: search.Summary.GROUP
});

const totalColumn = search.createColumn({
    name: 'total',
    summary: search.Summary.MAX
});

const soSearch = search.create({
    type: search.Type.SALES_ORDER,
    filters,
    columns: [
        zoneColumn,
        createdDateColumn,
        internalIdColumn,
        search.createColumn({
            name: 'tranid',
            summary: search.Summary.GROUP
        }),
        search.createColumn({
            name: 'entity',
            summary: search.Summary.GROUP
        }),
        search.createColumn({
            name: 'trandate',
            summary: search.Summary.GROUP
        }),
        search.createColumn({
            name: 'shipdate',
            summary: search.Summary.GROUP
        }),
        search.createColumn({
            name: 'otherrefnum',
            summary: search.Summary.GROUP
        }),
        totalColumn,
        search.createColumn({
            name: 'entitystatus',
            join: 'customer',
            summary: search.Summary.GROUP
        }),
        search.createColumn({
            name: 'createdby',
            summary: search.Summary.GROUP
        }),
        search.createColumn({
            name: 'memo',
            summary: search.Summary.GROUP
        }),
        search.createColumn({
            name: 'currency',
            summary: search.Summary.GROUP
        }),
        search.createColumn({
            name: 'statusref',
            summary: search.Summary.GROUP
        })
    ]
});

    const results = [];
    const orderIds = [];

    soSearch.run().each(result => {
        if (results.length >= PAGE_SIZE) {
            return false;
        }

        const id = result.getValue(internalIdColumn);

        orderIds.push(id);

        results.push({
    id,
    tranid: result.getValue({
        name: 'tranid',
        summary: search.Summary.GROUP
    }),
    customer: result.getText({
        name: 'entity',
        summary: search.Summary.GROUP
    }),
    trandate: result.getValue({
        name: 'trandate',
        summary: search.Summary.GROUP
    }),
    shipdate: result.getValue({
        name: 'shipdate',
        summary: search.Summary.GROUP
    }),
    po: result.getValue({
        name: 'otherrefnum',
        summary: search.Summary.GROUP
    }),
    total: result.getValue(totalColumn),
    holdCode: result.getText({
        name: 'entitystatus',
        join: 'customer',
        summary: search.Summary.GROUP
    }),
    enteredBy: result.getText({
        name: 'createdby',
        summary: search.Summary.GROUP
    }),
    memo: result.getValue({
        name: 'memo',
        summary: search.Summary.GROUP
    }),
    currency: result.getText({
        name: 'currency',
        summary: search.Summary.GROUP
    }),
    status: result.getText({
        name: 'statusref',
        summary: search.Summary.GROUP
    }),
    zone: result.getValue(zoneColumn),
    createdDate: result.getValue(createdDateColumn),
    items: []
});

        return true;
    });

let finalResults = results;

if ((params.custpage_availability_filter || 'SOME_COMMITTED') === 'ALL_FULLY_COMMITTED') {
    const fullyCommittedMap = getFullyCommittedOrderMap(orderIds);

    finalResults = finalResults.filter(order => {
        return fullyCommittedMap[order.id] === true;
    });
}

/*
 * Exclude Sales Orders that already have at least one Item Fulfillment.
 * This means partially fulfilled Sales Orders will no longer show.
 */
const fulfilledOrderMap = getSalesOrdersWithItemFulfillments(
    finalResults.map(order => order.id)
);

finalResults = finalResults.filter(order => {
    return fulfilledOrderMap[order.id] !== true;
});

const finalOrderIds = finalResults.map(order => order.id);
const itemDetailsByOrder = getOrderItemDetails(finalOrderIds);

finalResults.forEach(order => {
    order.items = itemDetailsByOrder[order.id] || [];
});

return finalResults;
      
}
  function getFullyCommittedOrderMap(orderIds) {
    const map = {};

    if (!orderIds || !orderIds.length) {
        return map;
    }

    orderIds.forEach(orderId => {
        map[orderId] = true;
    });

    const lineSearch = search.create({
        type: search.Type.SALES_ORDER,
        filters: [
            ['type', 'anyof', 'SalesOrd'],
            'AND',
            ['internalid', 'anyof', orderIds],
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
            ['quantity', 'greaterthan', '0'],
            'AND',
            ['formulanumeric: NVL({quantity},0) - NVL({quantityshiprecv},0)', 'greaterthan', '0']
        ],
        columns: [
            search.createColumn({
                name: 'internalid'
            }),
            search.createColumn({
                name: 'quantity'
            }),
            search.createColumn({
                name: 'quantityshiprecv'
            }),
            search.createColumn({
                name: 'quantitycommitted'
            })
        ]
    });

    lineSearch.run().each(result => {
        const orderId = result.getValue({
            name: 'internalid'
        });

        const quantity = Number(result.getValue({
            name: 'quantity'
        }) || 0);

        const fulfilled = Number(result.getValue({
            name: 'quantityshiprecv'
        }) || 0);

        const committed = Number(result.getValue({
            name: 'quantitycommitted'
        }) || 0);

        const remaining = Math.max(quantity - fulfilled, 0);

        if (remaining > 0 && committed < remaining) {
            map[orderId] = false;
        }

        return true;
    });

    return map;
}
function getSalesOrdersWithItemFulfillments(orderIds) {
    const map = {};

    if (!orderIds || !orderIds.length) {
        return map;
    }

    const fulfillmentSearch = search.create({
        type: search.Type.ITEM_FULFILLMENT,
        filters: [
            ['mainline', 'is', 'T'],
            'AND',
            ['createdfrom', 'anyof', orderIds]
        ],
        columns: [
            search.createColumn({
                name: 'createdfrom'
            })
        ]
    });

    fulfillmentSearch.run().each(result => {
        const salesOrderId = result.getValue({
            name: 'createdfrom'
        });

        if (salesOrderId) {
            map[salesOrderId] = true;
        }

        return true;
    });

    return map;
}

function getOrderItemDetails(orderIds) {
    const details = {};

    if (!orderIds || !orderIds.length) {
        return details;
    }

    const quantityUomColumn = search.createColumn({
        name: 'quantityuom'
    });

    const backOrderQtyColumn = search.createColumn({
        name: 'formulanumeric',
        formula: 'NVL({quantity},0) - NVL({quantityshiprecv},0) - NVL({quantitycommitted},0)'
    });

    const itemSearch = search.create({
        type: search.Type.SALES_ORDER,
        filters: [
            ['type', 'anyof', 'SalesOrd'],
            'AND',
            ['internalid', 'anyof', orderIds],
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
            ['quantity', 'greaterthan', '0']
        ],
        columns: [
            search.createColumn({
                name: 'internalid',
                sort: search.Sort.ASC
            }),
            search.createColumn({
                name: 'line',
                sort: search.Sort.ASC
            }),
            search.createColumn({
                name: 'item'
            }),
            search.createColumn({
                name: 'memo'
            }),
            search.createColumn({
                name: 'salesdescription',
                join: 'item'
            }),
            search.createColumn({
                name: 'quantity'
            }),
            quantityUomColumn,
            search.createColumn({
                name: 'quantitycommitted'
            }),
            search.createColumn({
                name: 'quantityshiprecv'
            }),
            backOrderQtyColumn,
            search.createColumn({
                name: 'unit'
            }),
            search.createColumn({
                name: 'amount'
            }),
            search.createColumn({
                name: 'estgrossprofitpercent'
            }),
            search.createColumn({
                name: 'costestimate'
            }),
            search.createColumn({
                name: 'weight',
                join: 'item'
            })
        ]
    });

    itemSearch.run().each(result => {
        const orderId = result.getValue({
            name: 'internalid'
        });

        /*
         * baseOrderQty is usually the base/stock unit quantity.
         * orderQtyUom is the Sales Order transaction-unit quantity.
         *
         * Example:
         * baseOrderQty = 4800
         * orderQtyUom = 200
         * unit = CS
         */
        const baseOrderQty = Number(result.getValue({
            name: 'quantity'
        }) || 0);

        const orderQtyUom = Number(result.getValue(quantityUomColumn) || baseOrderQty || 0);

        const fulfilledBaseQty = Number(result.getValue({
            name: 'quantityshiprecv'
        }) || 0);

        const committedBaseQty = Number(result.getValue({
            name: 'quantitycommitted'
        }) || 0);

        const amount = Number(result.getValue({
            name: 'amount'
        }) || 0);

        const itemWeight = Number(result.getValue({
            name: 'weight',
            join: 'item'
        }) || 0);

        /*
         * Convert base quantities back to transaction units.
         * Example:
         * 4800 base / 200 CS = 24 base units per CS.
         */
        const conversionRate =
            orderQtyUom && baseOrderQty
                ? baseOrderQty / orderQtyUom
                : 1;

        const fulfilledQtyUom =
            conversionRate
                ? fulfilledBaseQty / conversionRate
                : fulfilledBaseQty;

        const committedQtyUom =
            conversionRate
                ? committedBaseQty / conversionRate
                : committedBaseQty;

        const shipQtyUom =
            committedQtyUom > 0
                ? committedQtyUom
                : Math.max(orderQtyUom - fulfilledQtyUom, 0);

        const backOrderQtyUom = Math.max(
            orderQtyUom - fulfilledQtyUom - committedQtyUom,
            0
        );

        const unitPrice =
            orderQtyUom
                ? amount / orderQtyUom
                : 0;

        const line = {
            line: result.getValue({
                name: 'line'
            }),
            item: result.getText({
                name: 'item'
            }) || '',
            description: result.getValue({
                name: 'memo'
            }) || '',
            description2: result.getValue({
                name: 'salesdescription',
                join: 'item'
            }) || '',
            orderQty: formatDisplayNumber(orderQtyUom),
            shipQty: formatDisplayNumber(shipQtyUom),
            backOrderQty: formatDisplayNumber(backOrderQtyUom),
            unit: '',
            unitPrice: formatDisplayNumber(unitPrice),
            extended: formatDisplayNumber(amount),
            vendorPo: '',
            extWeight: itemWeight && shipQtyUom
                ? formatDisplayNumber(itemWeight * (shipQtyUom * conversionRate))
                : '',
            gpPercent: result.getValue({
                name: 'estgrossprofitpercent'
            }) || '',
            unitCost: result.getValue({
                name: 'costestimate'
            }) || ''
        };

        if (!details[orderId]) {
            details[orderId] = [];
        }

        details[orderId].push(line);

        return true;
    });

    populateSalesOrderLineUnits(details);

    return details;
}
function populateSalesOrderLineUnits(details) {
    Object.keys(details || {}).forEach(orderId => {
        try {
            const soRec = record.load({
                type: record.Type.SALES_ORDER,
                id: orderId,
                isDynamic: false
            });

            const lineCount = soRec.getLineCount({
                sublistId: 'item'
            });

            const unitByLine = {};

            for (let i = 0; i < lineCount; i++) {
                const lineNumber = String(soRec.getSublistValue({
                    sublistId: 'item',
                    fieldId: 'line',
                    line: i
                }) || '');

                const unitsText =
                    soRec.getSublistText({
                        sublistId: 'item',
                        fieldId: 'units',
                        line: i
                    }) ||
                    soRec.getSublistValue({
                        sublistId: 'item',
                        fieldId: 'units_display',
                        line: i
                    }) ||
                    soRec.getSublistValue({
                        sublistId: 'item',
                        fieldId: 'units',
                        line: i
                    }) ||
                    '';

                if (lineNumber) {
                    unitByLine[lineNumber] = unitsText;
                }
            }

            details[orderId].forEach(line => {
                if (line.line && unitByLine[String(line.line)]) {
                    line.unit = unitByLine[String(line.line)];
                }
            });
        } catch (e) {
            log.error({
                title: `Unable to load SO units for ${orderId}`,
                details: e
            });
        }
    });
}
function getTransactionTranId(recordType, internalId) {
    if (!internalId) {
        return '';
    }

    try {
        const lookup = search.lookupFields({
            type: recordType,
            id: internalId,
            columns: ['tranid']
        });

        return lookup.tranid || String(internalId);
    } catch (e) {
        log.error({
            title: `Unable to lookup tranid for ${recordType} ${internalId}`,
            details: e
        });

        return String(internalId);
    }
}
  function roundNumber(value, decimals) {
    const multiplier = Math.pow(10, decimals || 2);
    return Math.round(Number(value || 0) * multiplier) / multiplier;
}
function formatDisplayNumber(value) {
    const num = Number(value || 0);

    if (Number.isInteger(num)) {
        return String(num);
    }

    return String(roundNumber(num, 4));
}
    function processFulfillments(context) {
    const request = context.request;
    const params = request.parameters || {};

    let selectedSalesOrders = [];

    try {
        selectedSalesOrders = JSON.parse(params.custpage_fulfillment_payload || '[]');
    } catch (e) {
        selectedSalesOrders = [];
    }

    if (!selectedSalesOrders.length) {
        renderForm(context, 'No orders were selected.');
        return;
    }

    const results = [];

    selectedSalesOrders.forEach(order => {
        try {
            if (!order.truckDriver) {
    throw new Error('Picker is required.');
}

            if (!order.truck) {
                throw new Error('Truck is required.');
            }

const fulfillmentResult = createItemFulfillment({
    salesOrderId: order.soId,
    fulfillmentDate: params.custpage_fulfillment_date,
    shipStatus: params.custpage_shipstatus,
    truckDriver: order.truckDriver,
    truck: order.truck
});

const salesOrderTranId = getTransactionTranId(record.Type.SALES_ORDER, order.soId);

results.push(
    `Sales Order ${escapeHtml(salesOrderTranId)}: Item Fulfillment ${escapeHtml(fulfillmentResult.tranId)} created.`
);
        } catch (e) {
            log.error({
                title: `Fulfillment failed for SO ${order.soId}`,
                details: e
            });

            results.push(`Sales Order ${order.soId}: FAILED - ${e.message || e}`);
        }
    });

    renderForm(context, results.join('<br>'));
}

    function createItemFulfillment(options) {
        const {
    salesOrderId,
    locationId,
    fulfillmentDate,
    postingPeriod,
    shipStatus,
    shipVia,
    truckDriver,
    truck
} = options;

        const fulfillment = record.transform({
            fromType: record.Type.SALES_ORDER,
            fromId: salesOrderId,
            toType: record.Type.ITEM_FULFILLMENT,
            isDynamic: false
        });

        if (fulfillmentDate) {
            fulfillment.setValue({
                fieldId: 'trandate',
                value: parseDate(fulfillmentDate)
            });
        }

        if (postingPeriod) {
            fulfillment.setValue({
                fieldId: 'postingperiod',
                value: postingPeriod
            });
        }

        if (shipStatus) {
            fulfillment.setValue({
                fieldId: 'shipstatus',
                value: shipStatus
            });
        }

        if (shipVia) {
            fulfillment.setValue({
                fieldId: 'shipmethod',
                value: shipVia
            });
        }
      if (truckDriver) {
    fulfillment.setValue({
        fieldId: 'custbody_truck_driver',
        value: truckDriver
    });
}

if (truck) {
    fulfillment.setValue({
        fieldId: 'custbody_truck',
        value: truck
    });
}

        const lineCount = fulfillment.getLineCount({
            sublistId: 'item'
        });

        let hasReceivableLine = false;

        for (let i = 0; i < lineCount; i++) {
            const remainingQty = Number(
                fulfillment.getSublistValue({
                    sublistId: 'item',
                    fieldId: 'quantityremaining',
                    line: i
                }) || 0
            );

            const committedQty = Number(
                fulfillment.getSublistValue({
                    sublistId: 'item',
                    fieldId: 'quantitycommitted',
                    line: i
                }) || 0
            );

            let qtyToFulfill = committedQty > 0 ? committedQty : remainingQty;

            if (qtyToFulfill > remainingQty) {
                qtyToFulfill = remainingQty;
            }

            if (qtyToFulfill > 0) {
                fulfillment.setSublistValue({
                    sublistId: 'item',
                    fieldId: 'itemreceive',
                    line: i,
                    value: true
                });

                fulfillment.setSublistValue({
                    sublistId: 'item',
                    fieldId: 'quantity',
                    line: i,
                    value: qtyToFulfill
                });

                if (locationId) {
                    fulfillment.setSublistValue({
                        sublistId: 'item',
                        fieldId: 'location',
                        line: i,
                        value: locationId
                    });
                }

                hasReceivableLine = true;
            } else {
                fulfillment.setSublistValue({
                    sublistId: 'item',
                    fieldId: 'itemreceive',
                    line: i,
                    value: false
                });
            }
        }

        if (!hasReceivableLine) {
            throw new Error('No fulfillable lines were found on the transformed Item Fulfillment.');
        }

        const fulfillmentId = fulfillment.save({
    enableSourcing: true,
    ignoreMandatoryFields: false
});

return {
    id: fulfillmentId,
    tranId: getTransactionTranId(record.Type.ITEM_FULFILLMENT, fulfillmentId)
};
    }

    function parseDate(dateString) {
        return format.parse({
            value: dateString,
            type: format.Type.DATE
        });
    }

    function getTodayString() {
        return format.format({
            value: new Date(),
            type: format.Type.DATE
        });
    }

    function escapeHtml(value) {
        return String(value || '')
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