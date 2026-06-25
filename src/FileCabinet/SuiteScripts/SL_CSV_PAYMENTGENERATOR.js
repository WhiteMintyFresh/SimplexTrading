/**
 * @NApiVersion 2.1
 * @NScriptType Suitelet
 */
define(['N/ui/serverWidget', 'N/search', 'N/file'], (
    serverWidget,
    search,
    file
) => {

    const SEARCH_ID = 'customsearch_bank_payment_export';

    function onRequest(context) {
        if (context.request.method === 'GET') {
            showForm(context);
            return;
        }

        generateCsv(context);
    }

    function showForm(context) {
        const form = serverWidget.createForm({
            title: 'Generate Bank Payment CSV'
        });

        form.addField({
            id: 'custpage_payment_date',
            type: serverWidget.FieldType.DATE,
            label: 'Payment Date'
        }).isMandatory = true;

        form.addField({
            id: 'custpage_bank_account',
            type: serverWidget.FieldType.SELECT,
            label: 'Company Bank Account',
            source: 'account'
        }).isMandatory = true;

        form.addSubmitButton({
            label: 'Generate CSV'
        });

        context.response.writePage(form);
    }

    function generateCsv(context) {
        const paymentDate =
            context.request.parameters.custpage_payment_date;

        const bankAccount =
            context.request.parameters.custpage_bank_account;

        const rows = [];

        const paymentSearch = search.load({
            id: SEARCH_ID
        });

        paymentSearch.run().each(result => {
            const row = buildBankRow({
                result,
                paymentDate,
                bankAccount
            });

            rows.push(row);
            return true;
        });

        const csvContents = rows
            .map(row => row.map(escapeCsv).join(','))
            .join('\r\n');

        const csvFile = file.create({
            name: `BANK_PAYMENTS_${formatFileDate(new Date())}.csv`,
            fileType: file.Type.CSV,
            contents: csvContents,
            encoding: file.Encoding.UTF8
        });

        context.response.writeFile({
            file: csvFile,
            isInline: false
        });
    }

    function buildBankRow(options) {
        const result = options.result;

        return [
            result.getValue({ name: 'custbody_bank_payment_type' }),
            formatBankDate(options.paymentDate),
            result.getValue({ name: 'custbody_remitter_account' }),
            result.getValue({ name: 'custbody_remitter_currency' }),
            formatAmount(result.getValue({ name: 'amount' })),
            result.getText({ name: 'currency' }),
            result.getValue({
                name: 'custentity_beneficiary_account',
                join: 'vendor'
            }),
            result.getValue({
                name: 'custentity_beneficiary_currency',
                join: 'vendor'
            }),
            result.getValue({
                name: 'custentity_beneficiary_name',
                join: 'vendor'
            }),
            result.getValue({
                name: 'address1',
                join: 'vendor'
            }),
            result.getValue({
                name: 'address2',
                join: 'vendor'
            }),
            '',
            result.getValue({
                name: 'custentity_bank_code_type',
                join: 'vendor'
            }),
            result.getValue({
                name: 'custentity_bank_code',
                join: 'vendor'
            }),
            result.getValue({ name: 'tranid' }),
            result.getValue({ name: 'memo' }),
            '',
            '',
            result.getValue({
                name: 'custentity_bank_charges',
                join: 'vendor'
            }),
            result.getValue({
                name: 'custentity_payment_purpose',
                join: 'vendor'
            }),
            '',
            '',
            '',
            '',
            '',
            result.getValue({
                name: 'custentity_ach_account_type',
                join: 'vendor'
            })
        ];
    }

    function escapeCsv(value) {
        const text = value == null ? '' : String(value);

        if (/[",\r\n]/.test(text)) {
            return `"${text.replace(/"/g, '""')}"`;
        }

        return text;
    }

    function formatAmount(value) {
        const amount = Number(value || 0);
        return amount.toFixed(2);
    }

    function formatBankDate(value) {
        if (!value) {
            throw new Error('Payment date is required.');
        }

        const parts = String(value).split('/');

        if (parts.length === 3) {
            const month = parts[0].padStart(2, '0');
            const day = parts[1].padStart(2, '0');
            const year = parts[2];

            return `${year}${month}${day}`;
        }

        throw new Error(`Unsupported payment date: ${value}`);
    }

    function formatFileDate(date) {
        return [
            date.getFullYear(),
            String(date.getMonth() + 1).padStart(2, '0'),
            String(date.getDate()).padStart(2, '0')
        ].join('');
    }

    return {
        onRequest
    };
});