/**
 * @NApiVersion 2.1
 * @NScriptType Suitelet
 */
define([
    'N/ui/serverWidget',
    'N/search',
    'N/render',
    'N/file',
    'N/runtime',
    'N/log',
    'N/record',
    'N/url'
], (
    serverWidget,
    search,
    render,
    file,
    runtime,
    log,
    record,
    url
) => {

    const FIELD_ACTION = 'custpage_action';
    const FIELD_SELECTED = 'custpage_selected_invoices';

    const FIELD_INVOICE_NUMBER = 'custpage_invoice_number';
    const FIELD_TRUCK = 'custpage_truck';

    const PARAM_TEMP_FOLDER_ID = 'custscript_inv_temp_folder_id';

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

        addFilters(form, params);
        addResultsTable(form, params);

        context.response.writePage(form);
    }

    function addFilters(form, params) {
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

        const truck = form.addField({
            id: FIELD_TRUCK,
            label: 'Truck',
            type: serverWidget.FieldType.SELECT,
            source: 'customlist_truck_fulfillment',
            container: 'custpage_filters_left'
        });

        if (params[FIELD_TRUCK]) {
            truck.defaultValue = params[FIELD_TRUCK];
        }

        const rightGroup = form.addFieldGroup({
            id: 'custpage_filters_right',
            label: 'Documents in Queue'
        });

        const invoices = searchEligibleInvoices(params);

        const queueField = form.addField({
            id: 'custpage_documents_queue',
            label: ' ',
            type: serverWidget.FieldType.TEXT,
            container: 'custpage_filters_right'
        });

        queueField.updateDisplayType({
            displayType: serverWidget.FieldDisplayType.DISABLED
        });

        queueField.defaultValue = String(invoices.length);

        form.addButton({
            id: 'custpage_search',
            label: 'Search',
            functionName: 'refreshInvoices'
        });
    }

    function addResultsTable(form, params) {
        const invoices = searchEligibleInvoices(params);

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

    function searchEligibleInvoices(params) {
        const invoiceNumber = params[FIELD_INVOICE_NUMBER];
        const truckId = params[FIELD_TRUCK];

        const filters = [
            ['type', 'anyof', 'CustInvc'],
            'AND',
            ['mainline', 'is', 'T'],
            'AND',
            ['memorized', 'is', 'F']
        ];

        // Always allow reprinting. No tobeprinted filter is used.

        if (invoiceNumber) {
            filters.push('AND', ['tranid', 'contains', invoiceNumber]);
        }

        if (truckId) {
            filters.push('AND', search.createFilter({
                name: 'custbody_truck',
                join: 'createdFrom',
                operator: search.Operator.ANYOF,
                values: truckId
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

        const colCurrency = search.createColumn({
            name: 'currency'
        });

        const colStatus = search.createColumn({
            name: 'statusref'
        });

        const colCreatedFrom = search.createColumn({
            name: 'createdfrom'
        });

        const colTruck = search.createColumn({
            name: 'custbody_truck',
            join: 'createdFrom'
        });

        const colPicker = search.createColumn({
            name: 'custbody_truck_driver',
            join: 'createdFrom'
        });

        const invoices = [];

        search.create({
            type: search.Type.INVOICE,
            filters,
            columns: [
                colDate,
                colTranId,
                colInternalId,
                colEntity,
                colAmount,
                colCurrency,
                colStatus,
                colCreatedFrom,
                colTruck,
                colPicker
            ]
        }).run().each(result => {
            invoices.push({
                id: result.getValue(colInternalId) || '',
                date: result.getValue(colDate) || '',
                number: result.getValue(colTranId) || '',
                customer: result.getText(colEntity) || '',
                amount: result.getValue(colAmount) || '',
                currency: result.getText(colCurrency) || '',
                status: result.getText(colStatus) || '',
                salesOrder: result.getText(colCreatedFrom) || '',
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
                    <td colspan="10" style="text-align:center;padding:8px;">
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
                        <td>${escapeHtml(invoice.truck)}</td>
                        <td>${escapeHtml(invoice.picker)}</td>
                        <td style="text-align:right;">${escapeHtml(formatAmount(invoice.amount))}</td>
                        <td>${escapeHtml(invoice.status)}</td>
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
                            <th style="width:130px;">Truck</th>
                            <th style="width:130px;">Picker</th>
                            <th style="width:110px;text-align:right;">Amount</th>
                            <th style="width:120px;">Status</th>
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

        const invoiceIds = selectedInvoices
            .map(invoice => Number(invoice.id))
            .filter(id => !!id);

        if (!invoiceIds.length) {
            renderInvoicePage(context, 'No valid invoice IDs were selected.');
            return;
        }

        let pdfFile;

        if (invoiceIds.length === 1) {
            pdfFile = renderSingleInvoice(invoiceIds[0]);
            pdfFile.name = `Invoice_${selectedInvoices[0].number || invoiceIds[0]}.pdf`;
        } else {
            pdfFile = renderMultipleInvoices(invoiceIds);
            pdfFile.name = 'Invoices.pdf';
        }

        clearToBePrinted(invoiceIds);

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
        const tempFolderId = runtime.getCurrentScript().getParameter({
            name: PARAM_TEMP_FOLDER_ID
        });

        if (!tempFolderId) {
            throw new Error('Missing Suitelet deployment parameter custscript_inv_temp_folder_id. This is required when printing multiple invoices.');
        }

        const appDomain = url.resolveDomain({
            hostType: url.HostType.APPLICATION
        });

        const tempFileIds = [];
        const pdfNodes = [];

        try {
            invoiceIds.forEach(invoiceId => {
                const invoicePdf = renderSingleInvoice(invoiceId);

                invoicePdf.name = `Invoice_${invoiceId}.pdf`;
                invoicePdf.folder = Number(tempFolderId);
                invoicePdf.isOnline = true;

                const fileId = invoicePdf.save();
                tempFileIds.push(fileId);

                const savedFile = file.load({
                    id: fileId
                });

                const fileUrl = `https://${appDomain}${savedFile.url}`;

                pdfNodes.push(`<pdf src="${escapeXml(fileUrl)}"/>`);
            });

            const xml = `<?xml version="1.0"?>
<!DOCTYPE pdf PUBLIC "-//big.faceless.org//report" "report-1.1.dtd">
<pdfset>
    ${pdfNodes.join('\n')}
</pdfset>`;

            return render.xmlToPdf({
                xmlString: xml
            });

        } finally {
            tempFileIds.forEach(fileId => {
                try {
                    file.delete({
                        id: fileId
                    });
                } catch (e) {
                    log.error({
                        title: 'Could not delete temporary invoice PDF',
                        details: {
                            fileId,
                            error: e
                        }
                    });
                }
            });
        }
    }

    function clearToBePrinted(invoiceIds) {
        invoiceIds.forEach(invoiceId => {
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
            } catch (e) {
                log.error({
                    title: 'Could not clear To Be Printed on invoice',
                    details: {
                        invoiceId,
                        error: e
                    }
                });
            }
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

    function escapeXml(value) {
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