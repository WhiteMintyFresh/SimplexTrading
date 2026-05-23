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

    const SEARCH_STATUS_PICKED = 'ItemShip:A';

const RECORD_STATUS_PICKED = 'A';
const RECORD_STATUS_PACKED = 'B';

    const PARAM_SCHEDULED_SCRIPT_ID = 'custscript_mop_sched_script_id';
    const PARAM_SCHEDULED_DEPLOY_ID = 'custscript_mop_sched_deploy_id';
    const PARAM_SYNC_LIMIT = 'custscript_mop_sync_limit';

    const SCHED_PARAM_PAYLOAD = 'custscript_mop_payload';

    function onRequest(context) {
        if (context.request.method === 'GET') {
            renderForm(context);
        } else {
            processSubmit(context);
        }
    }

    function renderForm(context, message) {
        const request = context.request;
        const params = request.parameters || {};

        const form = serverWidget.createForm({
            title: 'Simplex Mark Orders Packed'
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

        const customer = form.addField({
            id: 'custpage_customer',
            label: 'Customer',
            type: serverWidget.FieldType.SELECT,
            source: 'customer',
            container: 'custpage_filters'
        });
        customer.defaultValue = params.custpage_customer || '';

        const orderType = form.addField({
            id: 'custpage_ordertype',
            label: 'Order Type',
            type: serverWidget.FieldType.SELECT,
            container: 'custpage_filters'
        });

        orderType.addSelectOption({ value: '', text: '' });
        orderType.addSelectOption({ value: 'SalesOrd', text: 'Sales Order' });
        orderType.addSelectOption({ value: 'TrnfrOrd', text: 'Transfer Order' });
        orderType.defaultValue = params.custpage_ordertype || '';

        const location = form.addField({
            id: 'custpage_location',
            label: 'Bulk Fulfill From Location',
            type: serverWidget.FieldType.SELECT,
            source: 'location',
            container: 'custpage_filters'
        });
        location.defaultValue = params.custpage_location || '';

        const shipVia = form.addField({
            id: 'custpage_shipvia',
            label: 'Ship Via',
            type: serverWidget.FieldType.SELECT,
            source: 'shipitem',
            container: 'custpage_filters'
        });
        shipVia.defaultValue = params.custpage_shipvia || '';

        const orderNumber = form.addField({
            id: 'custpage_ordernumber',
            label: 'Select Order Number',
            type: serverWidget.FieldType.TEXT,
            container: 'custpage_filters'
        });
        orderNumber.defaultValue = params.custpage_ordernumber || '';
    }

    function addFulfillmentTable(form, params) {
        const fulfillments = getPickedFulfillments(params);

        const html = form.addField({
            id: 'custpage_fulfillment_html',
            label: 'Fulfillments',
            type: serverWidget.FieldType.INLINEHTML
        });

        html.updateLayoutType({
            layoutType: serverWidget.FieldLayoutType.OUTSIDEBELOW
        });

        html.defaultValue = buildTableHtml(fulfillments);
    }

    function getPickedFulfillments(params) {
    const filters = [
        ['type', 'anyof', 'ItemShip'],
        'AND',
        ['mainline', 'is', 'T'],
        'AND',
        ['status', 'anyof', SEARCH_STATUS_PICKED]
    ];

    if (params.custpage_customer) {
        filters.push('AND', ['entity', 'anyof', params.custpage_customer]);
    }

    if (params.custpage_location) {
        filters.push('AND', ['location', 'anyof', params.custpage_location]);
    }

    if (params.custpage_shipvia) {
        filters.push('AND', ['shipmethod', 'anyof', params.custpage_shipvia]);
    }

    const columns = [
        search.createColumn({ name: 'trandate', sort: search.Sort.ASC }),
        search.createColumn({ name: 'tranid' }),
        search.createColumn({ name: 'createdfrom' }),
        search.createColumn({ name: 'entity' }),
        search.createColumn({ name: 'shipmethod' }),
        search.createColumn({ name: 'location' }),
        search.createColumn({ name: 'trackingnumbers' }),
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

            const orderTypeValue = result.getValue({
                name: 'type',
                join: 'createdFrom'
            }) || '';

            const orderTypeText = result.getText({
                name: 'type',
                join: 'createdFrom'
            }) || '';

            if (params.custpage_ordertype) {
                if (orderTypeValue !== params.custpage_ordertype) {
                    return;
                }
            }

            if (params.custpage_ordernumber) {
                const needle = String(params.custpage_ordernumber).toLowerCase();
                const haystack = String(orderNumber).toLowerCase();

                if (!haystack.includes(needle)) {
                    return;
                }
            }

            results.push({
                id: result.id,
                date: result.getValue('trandate') || '',
                fulfillmentNumber: result.getValue('tranid') || '',
                orderId: result.getValue('createdfrom') || '',
                orderText: result.getText('createdfrom') || orderNumber,
                orderType: orderTypeText,
                customer: result.getText('entity') || '',
                shipMethod: result.getText('shipmethod') || '',
                location: result.getText('location') || '',
                tracking: result.getValue('trackingnumbers') || ''
            });
        });
    });

    return results;
}

    function buildTableHtml(rows) {
        let rowsHtml = '';

        if (!rows.length) {
            rowsHtml = `
                <tr>
                    <td colspan="10" style="text-align:center;padding:14px;">
                        No picked item fulfillments found.
                    </td>
                </tr>
            `;
        } else {
            rows.forEach(row => {
                rowsHtml += `
                    <tr data-ifid="${escapeHtml(row.id)}">
                        <td class="center">
                            <input type="checkbox" class="pack-check" data-ifid="${escapeHtml(row.id)}">
                        </td>
                        <td>${escapeHtml(row.date)}</td>
                        <td>${escapeHtml(row.fulfillmentNumber)}</td>
                        <td>${escapeHtml(row.orderType)}</td>
                        <td>${escapeHtml(row.orderText)}</td>
                        <td>${escapeHtml(row.customer)}</td>
                        <td>${escapeHtml(row.shipMethod)}</td>
                        <td>${escapeHtml(row.location)}</td>
                        <td>
                            <input type="text" class="pack-weight" data-ifid="${escapeHtml(row.id)}" style="width:120px;">
                        </td>
                        <td>
                            <input type="text" class="pack-tracking" data-ifid="${escapeHtml(row.id)}" value="${escapeHtml(row.tracking)}" style="width:180px;">
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
                    min-width: 1200px;
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

                .packed-table tr:hover td {
                    background: #eef6fb;
                }

                .center {
                    text-align: center;
                }
            </style>

            <div class="packed-page">
                <div class="packed-table-wrapper">
                    <table class="packed-table">
                        <thead>
                            <tr>
                                <th>Pack</th>
                                <th>Date</th>
                                <th>Fulfillment #</th>
                                <th>Order Type</th>
                                <th>Order #</th>
                                <th>Customer Name</th>
                                <th>Ship Method</th>
                                <th>Location</th>
                                <th>Weight (lbs)</th>
                                <th>Tracking Number</th>
                            </tr>
                        </thead>
                        <tbody>
                            ${rowsHtml}
                        </tbody>
                    </table>
                </div>
            </div>

            <script>
                function markAllPackedRows() {
                    document.querySelectorAll('.pack-check').forEach(function(cb) {
                        cb.checked = true;
                    });
                }

                function unmarkAllPackedRows() {
                    document.querySelectorAll('.pack-check').forEach(function(cb) {
                        cb.checked = false;
                    });
                }

                document.addEventListener('submit', function() {
                    var payload = [];

                    document.querySelectorAll('.pack-check:checked').forEach(function(cb) {
                        var ifId = cb.getAttribute('data-ifid');

                        var weightEl = document.querySelector('.pack-weight[data-ifid="' + ifId + '"]');
                        var trackingEl = document.querySelector('.pack-tracking[data-ifid="' + ifId + '"]');

                        payload.push({
                            fulfillmentId: ifId,
                            weight: weightEl ? weightEl.value : '',
                            trackingNumber: trackingEl ? trackingEl.value : ''
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
            `Packed ${result.success} fulfillment(s). Failed: ${result.failed}.`
        );
    }

    function markFulfillmentsPacked(payload) {
        let success = 0;
        let failed = 0;

        payload.forEach(line => {
            try {
                updatePackageInfoIfNeeded(
                    line.fulfillmentId,
                    line.weight,
                    line.trackingNumber
                );

                record.submitFields({
    type: record.Type.ITEM_FULFILLMENT,
    id: line.fulfillmentId,
    values: {
        shipstatus: RECORD_STATUS_PACKED
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
                    title: `Failed to pack fulfillment ${line.fulfillmentId}`,
                    details: e
                });
            }
        });

        return { success, failed };
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

    return {
        onRequest
    };
});