/**
 * @NApiVersion 2.1
 * @NScriptType Suitelet
 */
define([
    'N/ui/serverWidget',
    'N/search',
    'N/render',
    'N/runtime',
    'N/log',
    'N/record'
], (
    serverWidget,
    search,
    render,
    runtime,
    log,
    record
) => {

const FIELD_ACTION = 'custpage_action';
const FIELD_SELECTED = 'custpage_selected_invoices';

const FIELD_INVOICE_NUMBER = 'custpage_invoice_number';
const FIELD_LOCATION = 'custpage_location';
const FIELD_TRUCK = 'custpage_truck';
const FIELD_PICKER = 'custpage_picker';
const FIELD_ALLOW_REPRINT = 'custpage_allow_reprint';

const SO_TRUCK_FIELD_ID = 'custbody_truck';

// IMPORTANT:
// Change this if your Sales Order picker body field has a different script ID.
const SO_PICKER_FIELD_ID = 'custbody_simplex_picked_by';

const TRUCK_LIST_ID = 'customlist_truck_fulfillment';
const PICKER_LIST_ID = 'customlist_spx_pickers';

// Roles allowed to see and use Allow Reprinting.
// Internal IDs are from the current Simplex account. Script IDs provide a
// second check when the script is moved between Sandbox and Production.
const REPRINT_ROLE_INTERNAL_IDS = Object.freeze([
    3,      // Administrator
    1118,   // Simplex A/R
    1129    // Simplex Accountant
]);

const REPRINT_ROLE_SCRIPT_IDS = Object.freeze([
    'administrator',
    'customrole1118', // Simplex A/R
    'customrole1129'  // Simplex Accountant
]);

/*
 * Keep synchronous print batches deliberately below the Suitelet's
 * 1,000-unit governance limit and the PDF renderer's 10 MB limit.
 *
 * The optimized multi-print path costs roughly:
 *   10 units per invoice to render
 * + 10 units per queued invoice to clear To Be Printed
 * + 10 units once to merge the PDF set
 * + search and safety overhead
 */
const MAX_INVOICES_PER_PRINT = 35;
const MAX_PDFSET_XML_LENGTH = 8 * 1024 * 1024;
const USAGE_RESERVE = 100;
const RENDER_TRANSACTION_UNITS = 10;
const SUBMIT_TRANSACTION_UNITS = 10;
const XML_TO_PDF_UNITS = 10;
const QUEUED_ID_SEARCH_UNITS = 10;
const REPRINT_ACCESS_SEARCH_UNITS = 10;

    function onRequest(context) {
        try {
            if (context.request.method === 'POST') {
                const action = context.request.parameters[FIELD_ACTION];

                if (action === 'print') {
                    printInvoices(context);
                    return;
                }
            }

            renderInvoicePage(context);

        } catch (e) {
            log.error({
                title: 'Print Invoices Suitelet Error',
                details: e
            });

            renderInvoicePage(context, 'Error: ' + e.message);
        }
    }

    function renderInvoicePage(context, message) {
        const params = context.request.parameters || {};
        const canAllowReprinting = currentRoleCanAllowReprinting();

        const form = serverWidget.createForm({
            title: 'Print Invoices'
        });

        form.clientScriptModulePath = './cs_print_invoices.js';

        form.addButton({
            id: 'custpage_print_top',
            label: 'Print',
            functionName: 'printInvoices'
        });

        form.addButton({
            id: 'custpage_mark_all_top',
            label: 'Mark All',
            functionName: 'markAllInvoices'
        });

        form.addButton({
            id: 'custpage_unmark_all_top',
            label: 'Unmark All',
            functionName: 'unmarkAllInvoices'
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
            label: 'Selected Invoices',
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

        // Run this search once. The previous version ran the same invoice
        // search once for the queue count and again for the results table.
        const invoices = searchEligibleInvoices(params, canAllowReprinting);

        addFilters(form, params, invoices.length, canAllowReprinting);
        addResultsTable(form, invoices);

        context.response.writePage(form);
    }

function addFilters(form, params, queueCount, canAllowReprinting) {
    const leftGroup = form.addFieldGroup({
        id: 'custpage_filters_left',
        label: 'Filter By'
    });

    const invoiceNumber = form.addField({
        id: FIELD_INVOICE_NUMBER,
        label: 'Invoice Number',
        type: serverWidget.FieldType.TEXT,
        container: 'custpage_filters_left'
    });

    invoiceNumber.defaultValue = params[FIELD_INVOICE_NUMBER] || '';

    const location = form.addField({
        id: FIELD_LOCATION,
        label: 'Location',
        type: serverWidget.FieldType.SELECT,
        source: 'location',
        container: 'custpage_filters_left'
    });

    if (params[FIELD_LOCATION]) {
        location.defaultValue = params[FIELD_LOCATION];
    }

    const truck = form.addField({
        id: FIELD_TRUCK,
        label: 'Truck',
        type: serverWidget.FieldType.SELECT,
        source: TRUCK_LIST_ID,
        container: 'custpage_filters_left'
    });

    if (params[FIELD_TRUCK]) {
        truck.defaultValue = params[FIELD_TRUCK];
    }

    const picker = form.addField({
        id: FIELD_PICKER,
        label: 'Picker',
        type: serverWidget.FieldType.SELECT,
        source: PICKER_LIST_ID,
        container: 'custpage_filters_left'
    });

    if (params[FIELD_PICKER]) {
        picker.defaultValue = params[FIELD_PICKER];
    }

    const rightGroup = form.addFieldGroup({
        id: 'custpage_filters_right',
        label: 'Documents in Queue'
    });

    const queueField = form.addField({
        id: 'custpage_documents_queue',
        label: ' ',
        type: serverWidget.FieldType.TEXT,
        container: 'custpage_filters_right'
    });

    queueField.updateDisplayType({
        displayType: serverWidget.FieldDisplayType.DISABLED
    });

    queueField.defaultValue = String(queueCount);

    const allowReprint = form.addField({
        id: FIELD_ALLOW_REPRINT,
        label: 'Allow Reprinting',
        type: serverWidget.FieldType.CHECKBOX,
        container: 'custpage_filters_right'
    });

    if (canAllowReprinting) {
        allowReprint.defaultValue = params[FIELD_ALLOW_REPRINT] === 'T' ? 'T' : 'F';
    } else {
        // Keep the field present but hidden so the existing client script can
        // safely read it without exposing the option to unauthorized roles.
        allowReprint.defaultValue = 'F';
        allowReprint.updateDisplayType({
            displayType: serverWidget.FieldDisplayType.HIDDEN
        });
    }

    form.addButton({
        id: 'custpage_search',
        label: 'Search',
        functionName: 'refreshInvoices'
    });
}

    function addResultsTable(form, invoices) {
        const htmlField = form.addField({
            id: 'custpage_results_html',
            label: 'Results',
            type: serverWidget.FieldType.INLINEHTML
        });

        htmlField.updateLayoutType({
            layoutType: serverWidget.FieldLayoutType.OUTSIDEBELOW
        });

        htmlField.defaultValue = buildResultsHtml(invoices);
    }

function searchEligibleInvoices(params, canAllowReprinting) {
    const invoiceNumber = params[FIELD_INVOICE_NUMBER];
    const locationId = params[FIELD_LOCATION];
    const truckId = params[FIELD_TRUCK];
    const pickerId = params[FIELD_PICKER];
    // Never trust a request parameter by itself. Unauthorized roles always
    // receive only invoices that are still marked To Be Printed.
    const allowReprint =
        canAllowReprinting && params[FIELD_ALLOW_REPRINT] === 'T';

    const filters = [];

    filters.push(search.createFilter({
        name: 'type',
        operator: search.Operator.ANYOF,
        values: 'CustInvc'
    }));

    filters.push(search.createFilter({
        name: 'mainline',
        operator: search.Operator.IS,
        values: 'T'
    }));

    filters.push(search.createFilter({
        name: 'memorized',
        operator: search.Operator.IS,
        values: 'F'
    }));

    /*
     * Initial load:
     * Allow Reprinting is unchecked by default.
     * This means only invoices with To Be Printed = T are returned.
     */
    if (!allowReprint) {
        filters.push(search.createFilter({
            name: 'tobeprinted',
            operator: search.Operator.IS,
            values: 'T'
        }));
    }

    if (invoiceNumber) {
        filters.push(search.createFilter({
            name: 'tranid',
            operator: search.Operator.CONTAINS,
            values: invoiceNumber
        }));
    }

    if (locationId) {
        filters.push(search.createFilter({
            name: 'location',
            operator: search.Operator.ANYOF,
            values: locationId
        }));
    }

    if (truckId) {
        filters.push(search.createFilter({
            name: SO_TRUCK_FIELD_ID,
            join: 'createdFrom',
            operator: search.Operator.ANYOF,
            values: truckId
        }));
    }

    if (pickerId) {
        filters.push(search.createFilter({
            name: SO_PICKER_FIELD_ID,
            join: 'createdFrom',
            operator: search.Operator.ANYOF,
            values: pickerId
        }));
    }

    const colDate = search.createColumn({
        name: 'trandate',
        sort: search.Sort.DESC
    });

    const colTranId = search.createColumn({
        name: 'tranid'
    });

    const colInternalId = search.createColumn({
        name: 'internalid'
    });

    const colEntity = search.createColumn({
        name: 'entity'
    });

    const colAmount = search.createColumn({
        name: 'amount'
    });

    const colStatus = search.createColumn({
        name: 'statusref'
    });

    const colToBePrinted = search.createColumn({
        name: 'tobeprinted'
    });

    const colCreatedFrom = search.createColumn({
        name: 'createdfrom'
    });

    const colLocation = search.createColumn({
        name: 'location'
    });

    const colTruck = search.createColumn({
        name: SO_TRUCK_FIELD_ID,
        join: 'createdFrom'
    });

    const colPicker = search.createColumn({
        name: SO_PICKER_FIELD_ID,
        join: 'createdFrom'
    });

    const invoices = [];

    search.create({
        type: search.Type.INVOICE,
        filters: filters,
        columns: [
            colDate,
            colTranId,
            colInternalId,
            colEntity,
            colAmount,
            colStatus,
            colToBePrinted,
            colCreatedFrom,
            colLocation,
            colTruck,
            colPicker
        ]
    }).run().each(result => {
        const toBePrintedValue = result.getValue(colToBePrinted);

        invoices.push({
            id: result.getValue(colInternalId) || '',
            date: result.getValue(colDate) || '',
            number: result.getValue(colTranId) || '',
            customer: result.getText(colEntity) || '',
            amount: result.getValue(colAmount) || '',
            status: result.getText(colStatus) || '',
            toBePrinted: toBePrintedValue === true || toBePrintedValue === 'T' ? 'Yes' : 'No',
            salesOrder: result.getText(colCreatedFrom) || '',
            location: result.getText(colLocation) || '',
            truck: result.getText(colTruck) || '',
            picker: result.getText(colPicker) || ''
        });

        return invoices.length < 1000;
    });

    return invoices;
}

    function buildResultsHtml(invoices) {
        let rows = '';

        if (!invoices.length) {
            rows = `
                <tr>
                    <td colspan="12" style="text-align:center;padding:8px;">
                        No records to show.
                    </td>
                </tr>
            `;
        } else {
            invoices.forEach(invoice => {
                rows += `
                    <tr>
                        <td style="text-align:center;">
                            <input 
                                type="checkbox" 
                                class="inv-check" 
                                data-id="${escapeHtml(invoice.id)}" 
                                data-number="${escapeHtml(invoice.number)}"
                            />
                        </td>
                        <td>${escapeHtml(invoice.date)}</td>
                        <td>${escapeHtml(invoice.number)}</td>
                        <td>${escapeHtml(invoice.id)}</td>
                        <td>${escapeHtml(invoice.customer)}</td>
                        <td>${escapeHtml(invoice.salesOrder)}</td>
                        <td>${escapeHtml(invoice.location)}</td>
                        <td>${escapeHtml(invoice.truck)}</td>
                        <td>${escapeHtml(invoice.picker)}</td>
                        <td style="text-align:right;">${escapeHtml(formatAmount(invoice.amount))}</td>
                        <td>${escapeHtml(invoice.status)}</td>
                        <td>${escapeHtml(invoice.toBePrinted)}</td>
                    </tr>
                `;
            });
        }

        return `
            <style>
                .inv-wrapper {
                    margin-top: 18px;
                    border: 1px solid #d9d9d9;
                    padding: 12px;
                }

                .inv-table {
                    width: 100%;
                    border-collapse: collapse;
                    font-size: 12px;
                }

                .inv-table th {
                    background: #f3f3f3;
                    border-bottom: 1px solid #ccc;
                    padding: 6px;
                    text-align: left;
                    font-weight: bold;
                }

                .inv-table td {
                    border-bottom: 1px solid #e5e5e5;
                    padding: 5px 6px;
                }

                .inv-bottom-buttons {
                    margin-top: 12px;
                }

                .inv-bottom-buttons button {
                    margin-right: 8px;
                    padding: 4px 12px;
                    cursor: pointer;
                }
            </style>

            <div class="inv-wrapper">
                <table class="inv-table">
                    <thead>
                        <tr>
                            <th style="width:50px;text-align:center;">Print</th>
                            <th style="width:90px;">Date</th>
                            <th style="width:120px;">Number</th>
                            <th style="width:70px;">ID</th>
                            <th>Customer</th>
                            <th style="width:130px;">Sales Order</th>
                            <th style="width:150px;">Location</th>
                            <th style="width:130px;">Truck</th>
                            <th style="width:130px;">Picker</th>
                            <th style="width:110px;text-align:right;">Amount</th>
                            <th style="width:120px;">Status</th>
                            <th style="width:90px;">To Print</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${rows}
                    </tbody>
                </table>
            </div>

            <div class="inv-bottom-buttons">
                <button type="button" onclick="printInvoices()">Print</button>
                <button type="button" onclick="markAllInvoices()">Mark All</button>
                <button type="button" onclick="unmarkAllInvoices()">Unmark All</button>
            </div>
        `;
    }

    function printInvoices(context) {
        const params = context.request.parameters || {};
        const selectedRaw = params[FIELD_SELECTED];

        if (!selectedRaw) {
            renderInvoicePage(context, 'Please select at least one invoice.');
            return;
        }

        const selectedInvoices = JSON.parse(selectedRaw);

        if (!selectedInvoices || !selectedInvoices.length) {
            renderInvoicePage(context, 'Please select at least one invoice.');
            return;
        }

        const invoiceIds = Array.from(new Set(
            selectedInvoices
                .map(invoice => Number(invoice.id))
                .filter(id => Number.isInteger(id) && id > 0)
        ));

        if (!invoiceIds.length) {
            renderInvoicePage(context, 'No valid invoice IDs were selected.');
            return;
        }

        const safePrintLimit = getSafePrintLimit();

        if (invoiceIds.length > safePrintLimit) {
            renderInvoicePage(
                context,
                `You selected ${invoiceIds.length} invoices. Print no more than ${safePrintLimit} invoices at a time so NetSuite can create the PDF and safely update the queue.`
            );
            return;
        }

        if (!currentRoleCanAllowReprinting()) {
            const queuedInvoiceIds = getQueuedInvoiceIds(invoiceIds);
            const queuedInvoiceIdSet = new Set(queuedInvoiceIds);
            const blockedInvoiceIds = invoiceIds.filter(
                invoiceId => !queuedInvoiceIdSet.has(invoiceId)
            );

            if (blockedInvoiceIds.length) {
                log.audit({
                    title: 'Unauthorized invoice reprint blocked',
                    details: {
                        role: runtime.getCurrentUser().role,
                        roleId: runtime.getCurrentUser().roleId || '',
                        blockedInvoiceIds
                    }
                });

                renderInvoicePage(
                    context,
                    'You can only print invoices that are currently marked To Be Printed. Allow Reprinting is restricted to Administrator, Simplex Accountant, and Simplex A/R.'
                );
                return;
            }
        }

        logUsage('Print Invoices - started', {
            invoiceCount: invoiceIds.length
        });

        let pdfFile;

        if (invoiceIds.length === 1) {
            pdfFile = renderSingleInvoice(invoiceIds[0]);
            pdfFile.name = `Invoice_${selectedInvoices[0].number || invoiceIds[0]}.pdf`;
        } else {
            pdfFile = renderMultipleInvoices(invoiceIds);
            pdfFile.name = 'Invoices.pdf';
        }

        logUsage('Print Invoices - PDF ready', {
            invoiceCount: invoiceIds.length
        });

        const clearResult = clearToBePrinted(invoiceIds);

        logUsage('Print Invoices - queue update complete', {
            requested: invoiceIds.length,
            cleared: clearResult.cleared.length,
            skipped: clearResult.skipped.length,
            failed: clearResult.failed.length
        });

        context.response.writeFile({
            file: pdfFile,
            isInline: true
        });
    }

    function renderSingleInvoice(invoiceId) {
        return render.transaction({
            entityId: invoiceId,
            printMode: render.PrintMode.PDF,
            inCustLocale: true
        });
    }

    function renderMultipleInvoices(invoiceIds) {
        const pdfNodes = [];
        let xmlLength = 0;

        invoiceIds.forEach(invoiceId => {
            const invoicePdf = renderSingleInvoice(invoiceId);
            const base64Pdf = invoicePdf.getContents();
            const pdfNode = `<pdf src="data:application/pdf;base64,${base64Pdf}"/>`;

            xmlLength += pdfNode.length;

            if (xmlLength > MAX_PDFSET_XML_LENGTH) {
                throw new Error(
                    'The selected invoices are too large to combine into one PDF. Select fewer invoices and print them in smaller batches.'
                );
            }

            pdfNodes.push(pdfNode);
        });

        const xml = `<?xml version="1.0"?>
<!DOCTYPE pdf PUBLIC "-//big.faceless.org//report" "report-1.1.dtd">
<pdfset>
    ${pdfNodes.join('\n')}
</pdfset>`;

        return render.xmlToPdf({
            xmlString: xml
        });
    }

    function clearToBePrinted(invoiceIds) {
        const queuedInvoiceIds = getQueuedInvoiceIds(invoiceIds);
        const result = {
            cleared: [],
            skipped: [],
            failed: []
        };

        if (!queuedInvoiceIds.length) {
            return result;
        }

        const requiredUsage =
            (queuedInvoiceIds.length * SUBMIT_TRANSACTION_UNITS) + USAGE_RESERVE;
        const remainingUsage = runtime.getCurrentScript().getRemainingUsage();

        // Avoid partially clearing a batch when the PDF consumed more usage
        // than expected. The PDF is still returned and every invoice remains
        // visible in the queue for a clean retry.
        if (remainingUsage < requiredUsage) {
            result.skipped = queuedInvoiceIds.slice();

            log.error({
                title: 'Skipped clearing To Be Printed - insufficient usage',
                details: {
                    remainingUsage,
                    requiredUsage,
                    invoiceIds: queuedInvoiceIds
                }
            });

            return result;
        }

        for (let index = 0; index < queuedInvoiceIds.length; index += 1) {
            const invoiceId = queuedInvoiceIds[index];
            const usageBeforeUpdate = runtime.getCurrentScript().getRemainingUsage();

            if (usageBeforeUpdate < (SUBMIT_TRANSACTION_UNITS + USAGE_RESERVE)) {
                result.skipped.push(...queuedInvoiceIds.slice(index));
                break;
            }

            try {
                record.submitFields({
                    type: record.Type.INVOICE,
                    id: invoiceId,
                    values: {
                        tobeprinted: false
                    },
                    options: {
                        enableSourcing: false,
                        ignoreMandatoryFields: true
                    }
                });

                result.cleared.push(invoiceId);
            } catch (e) {
                result.failed.push({
                    invoiceId,
                    name: e.name || '',
                    message: e.message || String(e)
                });
            }
        }

        if (result.failed.length || result.skipped.length) {
            log.error({
                title: 'Some invoices were not removed from the print queue',
                details: result
            });
        }

        return result;
    }

    function getQueuedInvoiceIds(invoiceIds) {
        const queuedInvoiceIds = [];

        search.create({
            type: search.Type.INVOICE,
            filters: [
                ['mainline', search.Operator.IS, 'T'],
                'and',
                ['internalid', search.Operator.ANYOF, invoiceIds],
                'and',
                ['tobeprinted', search.Operator.IS, 'T']
            ],
            columns: [
                search.createColumn({
                    name: 'internalid'
                })
            ]
        }).run().each(searchResult => {
            queuedInvoiceIds.push(Number(searchResult.id));
            return true;
        });

        return queuedInvoiceIds;
    }

    function getSafePrintLimit() {
        const remainingUsage = runtime.getCurrentScript().getRemainingUsage();
        const fixedUsage =
            XML_TO_PDF_UNITS +
            QUEUED_ID_SEARCH_UNITS +
            REPRINT_ACCESS_SEARCH_UNITS +
            USAGE_RESERVE;
        const perInvoiceUsage = RENDER_TRANSACTION_UNITS + SUBMIT_TRANSACTION_UNITS;
        const governanceLimit = Math.floor(
            Math.max(0, remainingUsage - fixedUsage) / perInvoiceUsage
        );

        return Math.max(1, Math.min(MAX_INVOICES_PER_PRINT, governanceLimit));
    }

    function currentRoleCanAllowReprinting() {
        const currentUser = runtime.getCurrentUser();
        const roleInternalId = Number(currentUser.role);
        const roleScriptId = String(currentUser.roleId || '').toLowerCase();

        return REPRINT_ROLE_INTERNAL_IDS.indexOf(roleInternalId) !== -1 ||
            REPRINT_ROLE_SCRIPT_IDS.indexOf(roleScriptId) !== -1;
    }

    function logUsage(title, details) {
        log.audit({
            title,
            details: Object.assign({
                remainingUsage: runtime.getCurrentScript().getRemainingUsage()
            }, details || {})
        });
    }

    function formatAmount(value) {
        const numberValue = Number(value || 0);

        return numberValue.toLocaleString('en-US', {
            minimumFractionDigits: 2,
            maximumFractionDigits: 2
        });
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
            .replace(/'/g, '&#39;');
    }

    return {
        onRequest
    };
});
