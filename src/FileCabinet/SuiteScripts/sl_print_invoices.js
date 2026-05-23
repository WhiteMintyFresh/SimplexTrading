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

    const FIELD_LOCATION = 'custpage_location';
    const FIELD_FORM = 'custpage_form';
    const FIELD_ALLOW_REPRINT = 'custpage_allow_reprint';

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

        const formField = form.addField({
            id: FIELD_FORM,
            label: 'Form',
            type: serverWidget.FieldType.SELECT,
            container: 'custpage_filters_left'
        });

        formField.addSelectOption({
            value: '',
            text: '- From Transaction -'
        });

        addInvoiceForms(formField);

        if (params[FIELD_FORM]) {
            formField.defaultValue = params[FIELD_FORM];
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

        const allowReprint = form.addField({
            id: FIELD_ALLOW_REPRINT,
            label: 'Allow Reprinting',
            type: serverWidget.FieldType.CHECKBOX,
            container: 'custpage_filters_right'
        });

        allowReprint.defaultValue = params[FIELD_ALLOW_REPRINT] === 'T' ? 'T' : 'F';

        form.addButton({
            id: 'custpage_customize',
            label: 'Customize',
            functionName: 'refreshInvoices'
        });
    }

    function addInvoiceForms(formField) {
        try {
            search.create({
                type: 'customtransactionform',
                filters: [
                    ['recordtype', 'is', 'CustInvc'],
                    'AND',
                    ['isinactive', 'is', 'F']
                ],
                columns: [
                    search.createColumn({ name: 'name' }),
                    search.createColumn({ name: 'internalid' })
                ]
            }).run().each(result => {
                formField.addSelectOption({
                    value: result.getValue({ name: 'internalid' }),
                    text: result.getValue({ name: 'name' })
                });

                return true;
            });
        } catch (e) {
            log.audit({
                title: 'Invoice Forms Could Not Be Loaded',
                details: e
            });
        }
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
        const locationId = params[FIELD_LOCATION];
        const allowReprint = params[FIELD_ALLOW_REPRINT] === 'T';

        const filters = [
            ['type', 'anyof', 'CustInvc'],
            'AND',
            ['mainline', 'is', 'T'],
            'AND',
            ['memorized', 'is', 'F']
        ];

        if (!allowReprint) {
            filters.push('AND', ['tobeprinted', 'is', 'T']);
        }

        if (locationId) {
            filters.push('AND', ['location', 'anyof', locationId]);
        }

        const invoices = [];

        search.create({
            type: search.Type.INVOICE,
            filters,
            columns: [
                search.createColumn({ name: 'trandate', sort: search.Sort.ASC }),
                search.createColumn({ name: 'tranid' }),
                search.createColumn({ name: 'internalid' }),
                search.createColumn({ name: 'entity' }),
                search.createColumn({ name: 'amount' }),
                search.createColumn({ name: 'currency' }),
                search.createColumn({ name: 'statusref' })
            ]
        }).run().each(result => {
            invoices.push({
                id: result.getValue({ name: 'internalid' }) || '',
                date: result.getValue({ name: 'trandate' }) || '',
                number: result.getValue({ name: 'tranid' }) || '',
                customer: result.getText({ name: 'entity' }) || '',
                amount: result.getValue({ name: 'amount' }) || '',
                currency: result.getText({ name: 'currency' }) || '',
                status: result.getText({ name: 'statusref' }) || ''
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
                    <td colspan="8" style="text-align:center;padding:8px;">
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
                        <td style="text-align:right;">${escapeHtml(formatAmount(invoice.amount))}</td>
                        <td>${escapeHtml(invoice.currency)}</td>
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
                            <th style="width:100px;">Date</th>
                            <th style="width:120px;">Number</th>
                            <th style="width:80px;">ID</th>
                            <th>Customer</th>
                            <th style="width:120px;text-align:right;">Amount</th>
                            <th style="width:110px;">Currency</th>
                            <th style="width:140px;">Status</th>
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

        const formId = params[FIELD_FORM] ? Number(params[FIELD_FORM]) : null;

        let pdfFile;

        if (invoiceIds.length === 1) {
            pdfFile = renderSingleInvoice(invoiceIds[0], formId);
            pdfFile.name = `Invoice_${selectedInvoices[0].number || invoiceIds[0]}.pdf`;
        } else {
            pdfFile = renderMultipleInvoices(invoiceIds, formId);
            pdfFile.name = 'Invoices.pdf';
        }

        clearToBePrinted(invoiceIds);

        context.response.writeFile({
            file: pdfFile,
            isInline: true
        });
    }

    function renderSingleInvoice(invoiceId, formId) {
        const options = {
            entityId: invoiceId,
            printMode: render.PrintMode.PDF,
            inCustLocale: true
        };

        if (formId) {
            options.formId = formId;
        }

        return render.transaction(options);
    }

    function renderMultipleInvoices(invoiceIds, formId) {
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
                const invoicePdf = renderSingleInvoice(invoiceId, formId);

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