/**
 * Bill Payments + CIBC Bulk CSV Suitelet
 *
 * @NApiVersion 2.1
 * @NScriptType Suitelet
 * @NModuleScope SameAccount
 *
 * Deployment parameters (all Free-Form Text unless stated otherwise):
 *  custscript_bp_csv_folder             Integer - optional File Cabinet folder
 *  custscript_bp_vendor_ben_acct        Vendor field ID
 *  custscript_bp_vendor_ben_currency    Vendor field ID (value should be ISO code)
 *  custscript_bp_vendor_ben_name        Vendor field ID; blank uses entityid/companyname
 *  custscript_bp_vendor_ben_addr1       Vendor field ID
 *  custscript_bp_vendor_ben_addr2       Vendor field ID
 *  custscript_bp_vendor_ben_addr3       Vendor field ID
 *  custscript_bp_vendor_code_type       Vendor field ID; value 0-6
 *  custscript_bp_vendor_bank_code       Vendor field ID
 *  custscript_bp_vendor_charges         Vendor field ID; SHA/BEN/OUR
 *  custscript_bp_vendor_purpose         Vendor field ID
 *  custscript_bp_vendor_acct_type       Vendor field ID; CH/SA/LN
 *  custscript_bp_bank_remitter_acct     Account field ID
 *  custscript_bp_bank_currency          Account field ID; blank uses account currency
 *  custscript_bp_payment_type           Default: 2 (ACH)
 *
 * Important:
 * 1. Test only in Sandbox.
 * 2. Replace/configure the vendor and bank custom field IDs before testing.
 * 3. One Vendor Payment is created per vendor/currency group.
 * 4. The CSV follows the 26-column CIBC bulk-upload layout.
 */
define([
    'N/ui/serverWidget',
    'N/search',
    'N/record',
    'N/runtime',
    'N/file',
    'N/format',
'N/error',
'N/log',
'N/url'
], (
    serverWidget,
    search,
    record,
    runtime,
    file,
    format,
error,
log,
url
) => {
    const IDS = {
        FORM: {
            SUBSIDIARY: 'custpage_subsidiary',
            AP_ACCOUNT: 'custpage_ap_account',
            BANK_ACCOUNT: 'custpage_bank_account',
            PAYMENT_DATE: 'custpage_payment_date',
            POSTING_PERIOD: 'custpage_posting_period',
            MEMO: 'custpage_memo',
            PAYMENT_TYPE: 'custpage_payment_type'
        },
        SUBLIST: 'custpage_bills',
        LINE: {
            APPLY: 'custpage_apply',
            BILL_ID: 'custpage_bill_id',
            DUE_DATE: 'custpage_due_date',
TRANID: 'custpage_tranid',
OPEN_BILL: 'custpage_open_bill',
VENDOR: 'custpage_vendor',
            VENDOR_ID: 'custpage_vendor_id',
            CURRENCY: 'custpage_currency',
            ORIGINAL: 'custpage_original',
            DUE: 'custpage_due',
            PAYMENT: 'custpage_payment'
        },
        PARAM: {
            CSV_FOLDER: 'custscript_bp_csv_folder',
            V_BEN_ACCT: 'custscript_bp_vendor_ben_acct',
            V_BEN_CURRENCY: 'custscript_bp_vendor_ben_currency',
            V_BEN_NAME: 'custscript_bp_vendor_ben_name',
            V_ADDR1: 'custscript_bp_vendor_ben_addr1',
            V_ADDR2: 'custscript_bp_vendor_ben_addr2',
            V_ADDR3: 'custscript_bp_vendor_ben_addr3',
            V_CODE_TYPE: 'custscript_bp_vendor_code_type',
            V_BANK_CODE: 'custscript_bp_vendor_bank_code',
            V_CHARGES: 'custscript_bp_vendor_charges',
            V_PURPOSE: 'custscript_bp_vendor_purpose',
            V_ACCT_TYPE: 'custscript_bp_vendor_acct_type',
            BANK_REMITTER: 'custscript_bp_bank_remitter_acct',
            BANK_CURRENCY: 'custscript_bp_bank_currency',
            PAYMENT_TYPE: 'custscript_bp_payment_type'
        }
    };

    const CSV_COLUMN_COUNT = 26;
    const MAX_RESULTS = 1000;

/*
 * SANDBOX TESTING ONLY.
 *
 * Set USE_DUMMY_BANK_DATA to false before production deployment.
 * These values are placeholders and must not be uploaded to the bank.
 */
const USE_DUMMY_BANK_DATA = true;

const DUMMY_BANK_DATA = {
    remitterAccount: '100100000',
    remitterCurrency: 'BBD',

    beneficiaryAccount: '123456789',
    beneficiaryCurrency: 'BBD',
    beneficiaryName: 'TEST BENEFICIARY',

    beneficiaryAddress1: 'TEST ADDRESS 1',
    beneficiaryAddress2: 'BRIDGETOWN',
    beneficiaryAddress3: 'BARBADOS',

    codeType: '6',
    bankCode: '00001',

    charges: 'OUR',
    purposeCode: '',
    achAccountType: 'CH'
};

    function onRequest(context) {
    try {
        const action =
            context.request.parameters.custpage_action || '';

        log.audit({
            title: 'Suitelet Request',
            details: {
                method: context.request.method,
                action: action,
                subsidiary:
                    context.request.parameters[IDS.FORM.SUBSIDIARY],
                apAccount:
                    context.request.parameters[IDS.FORM.AP_ACCOUNT],
                bankAccount:
                    context.request.parameters[IDS.FORM.BANK_ACCOUNT]
            }
        });

        if (
            context.request.method === 'GET' ||
            action === 'refresh'
        ) {
            renderForm(context);
            return;
        }

        createPaymentsAndCsv(context);

    } catch (e) {
        log.error({
            title: 'Bill Payment Suitelet failed',
            details: e
        });

        renderError(context, e);
    }
}

    function renderForm(context, message) {
        const request = context.request;
        const p = request.parameters || {};
        const form = serverWidget.createForm({ title: 'Bill Payments' });
        const actionField = form.addField({
    id: 'custpage_action',
    label: 'Action',
    type: serverWidget.FieldType.TEXT
});

actionField.updateDisplayType({
    displayType: serverWidget.FieldDisplayType.HIDDEN
});

actionField.defaultValue = 'create';

        form.addSubmitButton({ label: 'Create Payments & Generate CSV' });

        if (message) {
            const messageField = form.addField({
                id: 'custpage_message',
                label: 'Message',
                type: serverWidget.FieldType.INLINEHTML
            });
            messageField.defaultValue =
                '<div style="padding:10px;border:1px solid #b7c9d6;background:#f4f8fb;margin-bottom:12px;">' +
                escapeHtml(message) +
                '</div>';
        }

        const subsidiary = form.addField({
            id: IDS.FORM.SUBSIDIARY,
            label: 'Subsidiary',
            type: serverWidget.FieldType.SELECT,
            source: 'subsidiary'
        });
        subsidiary.isMandatory = true;
        if (p[IDS.FORM.SUBSIDIARY]) subsidiary.defaultValue = p[IDS.FORM.SUBSIDIARY];

        const apAccount = form.addField({
            id: IDS.FORM.AP_ACCOUNT,
            label: 'A/P Account',
            type: serverWidget.FieldType.SELECT,
            source: 'account'
        });
        apAccount.isMandatory = true;
        if (p[IDS.FORM.AP_ACCOUNT]) apAccount.defaultValue = p[IDS.FORM.AP_ACCOUNT];

        const bankAccount = form.addField({
            id: IDS.FORM.BANK_ACCOUNT,
            label: 'Bank Account',
            type: serverWidget.FieldType.SELECT,
            source: 'account'
        });
        bankAccount.isMandatory = true;
        if (p[IDS.FORM.BANK_ACCOUNT]) bankAccount.defaultValue = p[IDS.FORM.BANK_ACCOUNT];

        const paymentDate = form.addField({
            id: IDS.FORM.PAYMENT_DATE,
            label: 'Payment Date',
            type: serverWidget.FieldType.DATE
        });
        paymentDate.isMandatory = true;
        paymentDate.defaultValue = p[IDS.FORM.PAYMENT_DATE] || format.format({
            value: new Date(),
            type: format.Type.DATE
        });

        const postingPeriod = form.addField({
            id: IDS.FORM.POSTING_PERIOD,
            label: 'Posting Period',
            type: serverWidget.FieldType.SELECT,
            source: 'accountingperiod'
        });
        if (p[IDS.FORM.POSTING_PERIOD]) postingPeriod.defaultValue = p[IDS.FORM.POSTING_PERIOD];

        const paymentType = form.addField({
            id: IDS.FORM.PAYMENT_TYPE,
            label: 'Bank Payment Type',
            type: serverWidget.FieldType.SELECT
        });
        [
            ['0', 'Third Party / Internal'],
            ['1', 'International'],
            ['2', 'ACH Standard'],
            ['3', 'Own Account'],
            ['4', 'RTGS Urgent'],
            ['5', 'Credit Card Bill Payment'],
            ['6', 'Instant Payment']
        ].forEach(([value, text]) => paymentType.addSelectOption({ value, text }));
        paymentType.defaultValue =
            p[IDS.FORM.PAYMENT_TYPE] ||
            String(runtime.getCurrentScript().getParameter({ name: IDS.PARAM.PAYMENT_TYPE }) || '2');

        const memo = form.addField({
            id: IDS.FORM.MEMO,
            label: 'Memo',
            type: serverWidget.FieldType.TEXT
        });
        if (p[IDS.FORM.MEMO]) memo.defaultValue = p[IDS.FORM.MEMO];

        const refresh = form.addButton({
            id: 'custpage_refresh',
            label: 'Refresh Bills',
            functionName: 'refreshBills'
        });

        const inline = form.addField({
            id: 'custpage_inline_client',
            label: 'Client Logic',
            type: serverWidget.FieldType.INLINEHTML
        });
        inline.defaultValue = buildClientScript();

        const sublist = form.addSublist({
            id: IDS.SUBLIST,
            label: 'Open Vendor Bills',
            type: serverWidget.SublistType.LIST
        });
        sublist.addMarkAllButtons();

        sublist.addField({
            id: IDS.LINE.APPLY,
            label: 'Pay',
            type: serverWidget.FieldType.CHECKBOX
        });

        const billId = sublist.addField({
            id: IDS.LINE.BILL_ID,
            label: 'Bill Internal ID',
            type: serverWidget.FieldType.INTEGER
        });
        billId.updateDisplayType({ displayType: serverWidget.FieldDisplayType.HIDDEN });

        const vendorId = sublist.addField({
            id: IDS.LINE.VENDOR_ID,
            label: 'Vendor Internal ID',
            type: serverWidget.FieldType.INTEGER
        });
        vendorId.updateDisplayType({ displayType: serverWidget.FieldDisplayType.HIDDEN });

        sublist.addField({
            id: IDS.LINE.DUE_DATE,
            label: 'Date Due',
            type: serverWidget.FieldType.DATE
        });
sublist.addField({
    id: IDS.LINE.TRANID,
    label: 'Ref No.',
    type: serverWidget.FieldType.TEXT
});

const openBillField = sublist.addField({
    id: IDS.LINE.OPEN_BILL,
    label: 'Open',
    type: serverWidget.FieldType.URL
});

openBillField.linkText = 'View Bill';
        sublist.addField({
            id: IDS.LINE.VENDOR,
            label: 'Vendor',
            type: serverWidget.FieldType.TEXT
        });
        sublist.addField({
            id: IDS.LINE.CURRENCY,
            label: 'Currency',
            type: serverWidget.FieldType.TEXT
        });
        sublist.addField({
            id: IDS.LINE.ORIGINAL,
            label: 'Original Amount',
            type: serverWidget.FieldType.CURRENCY
        });
        sublist.addField({
            id: IDS.LINE.DUE,
            label: 'Amount Due',
            type: serverWidget.FieldType.CURRENCY
        });
        const payment = sublist.addField({
            id: IDS.LINE.PAYMENT,
            label: 'Payment',
            type: serverWidget.FieldType.CURRENCY
        });
        payment.updateDisplayType({ displayType: serverWidget.FieldDisplayType.ENTRY });

        if (
    p[IDS.FORM.SUBSIDIARY] &&
    p[IDS.FORM.AP_ACCOUNT] &&
    p[IDS.FORM.BANK_ACCOUNT]
) {
            const bills = getOpenBills({
    subsidiary: p[IDS.FORM.SUBSIDIARY],
    apAccount: p[IDS.FORM.AP_ACCOUNT],
    bankAccount: p[IDS.FORM.BANK_ACCOUNT]
});
            populateBills(sublist, bills);
        }

        context.response.writePage(form);
    }

    function buildBillSearchFilters(filters, bankCurrencyId) {
    const searchFilters = [
        ['mainline', 'is', 'T'],
        'AND',
        ['voided', 'is', 'F'],
        'AND',
        ['amountremaining', 'greaterthan', '0.00'],
        'AND',
        ['subsidiary', 'anyof', filters.subsidiary]
    ];

    if (bankCurrencyId) {
        searchFilters.push(
            'AND',
            ['currency', 'anyof', bankCurrencyId]
        );
    }

    return searchFilters;
}

    function getOpenBills(filters) {
    const results = [];
const bankAccountRecord = record.load({
    type: record.Type.ACCOUNT,
    id: Number(filters.bankAccount),
    isDynamic: false
});

const bankCurrencyId = String(
    bankAccountRecord.getValue({
        fieldId: 'currency'
    }) || ''
);

log.audit({
    title: 'Selected Bank Currency',
    details: {
        bankAccount: filters.bankAccount,
        bankCurrencyId: bankCurrencyId
    }
});
    const billSearch = search.create({
        type: search.Type.VENDOR_BILL,
filters: buildBillSearchFilters(
    filters,
    bankCurrencyId
),
        columns: [
            search.createColumn({
                name: 'internalid',
                sort: search.Sort.ASC
            }),
            'trandate',
            'duedate',
            'tranid',
            'entity',
            'currency',
            'fxamount',
            'fxamountremaining'
        ]
    });

    billSearch.run().each(result => {
        const billInternalId = result.getValue({
            name: 'internalid'
        });

        /*
         * Read the Vendor Bill body A/P Account directly.
         * Do not use the transaction-search "account" column here.
         */
        const billValues = search.lookupFields({
            type: search.Type.VENDOR_BILL,
            id: billInternalId,
            columns: ['account']
        });

        let billApAccount = '';

        if (
            billValues.account &&
            Array.isArray(billValues.account) &&
            billValues.account.length
        ) {
            billApAccount = String(
                billValues.account[0].value || ''
            );
        }

        log.debug({
            title: 'Vendor Bill A/P Account Check',
            details: {
                billInternalId: billInternalId,
                tranid: result.getValue({
                    name: 'tranid'
                }),
                billApAccount: billApAccount,
                selectedApAccount: String(filters.apAccount),
                subsidiary: String(filters.subsidiary),
                amountRemaining: result.getValue({
                    name: 'fxamountremaining'
                })
            }
        });

        if (billApAccount !== String(filters.apAccount)) {
            return true;
        }

        results.push({
            id: billInternalId,
            tranid: result.getValue({
                name: 'tranid'
            }) || '',
            dueDate: result.getValue({
                name: 'duedate'
            }) || '',
            vendorId: result.getValue({
                name: 'entity'
            }),
            vendorText: result.getText({
                name: 'entity'
            }) || '',
            currencyText: result.getText({
                name: 'currency'
            }) || '',
            originalAmount: toNumber(
                result.getValue({
                    name: 'fxamount'
                })
            ),
            amountDue: toNumber(
                result.getValue({
                    name: 'fxamountremaining'
                })
            )
        });

        return results.length < MAX_RESULTS;
    });

    log.audit({
        title: 'Open Vendor Bills Loaded',
        details: {
            subsidiary: filters.subsidiary,
            apAccount: filters.apAccount,
            count: results.length
        }
    });

    return results;
}

    function populateBills(sublist, bills) {
        bills.forEach((bill, line) => {
            setSublistValue(sublist, IDS.LINE.BILL_ID, line, bill.id);
            setSublistValue(sublist, IDS.LINE.VENDOR_ID, line, bill.vendorId);
            setSublistValue(sublist, IDS.LINE.DUE_DATE, line, bill.dueDate);
setSublistValue(
    sublist,
    IDS.LINE.TRANID,
    line,
    bill.tranid
);

const billUrl = url.resolveRecord({
    recordType: record.Type.VENDOR_BILL,
    recordId: bill.id,
    isEditMode: false
});

setSublistValue(
    sublist,
    IDS.LINE.OPEN_BILL,
    line,
    billUrl
);
            setSublistValue(sublist, IDS.LINE.VENDOR, line, bill.vendorText);
            setSublistValue(sublist, IDS.LINE.CURRENCY, line, bill.currencyText);
            setSublistValue(sublist, IDS.LINE.ORIGINAL, line, formatMoney(bill.originalAmount));
            setSublistValue(sublist, IDS.LINE.DUE, line, formatMoney(bill.amountDue));
            setSublistValue(sublist, IDS.LINE.PAYMENT, line, formatMoney(bill.amountDue));
        });
    }

    function createPaymentsAndCsv(context) {
        const request = context.request;
        const header = readHeader(request);
        const selected = readSelectedBills(request);

        if (!selected.length) {
            throw error.create({
                name: 'NO_BILLS_SELECTED',
                message: 'Select at least one bill and enter a payment amount.'
            });
        }

        const grouped = groupBills(selected);
        const groupKeys = Object.keys(grouped);

        // Validate all bank-export master data before the first accounting
        // transaction is saved. This prevents a missing vendor bank field from
        // creating a payment without producing a usable CSV.
        groupKeys.forEach(key => {
            buildPaymentCsvData(header, grouped[key], 'PENDING');
        });

        const created = [];
        groupKeys.forEach(key => {
            const group = grouped[key];
            const paymentId = createVendorPayment(header, group);
            const csvData = buildPaymentCsvData(header, group, paymentId);
            created.push({ paymentId, csvData });
        });

        const csv = created.map(item => buildCsvRow(item.csvData)).join('\r\n') + '\r\n';
        const fileName = 'CIBC_Bulk_Payments_' + timestampForFile(new Date()) + '.csv';
        const csvFile = file.create({
            name: fileName,
            fileType: file.Type.CSV,
            contents: csv,
            encoding: file.Encoding.UTF8
        });

        const folderId = runtime.getCurrentScript().getParameter({ name: IDS.PARAM.CSV_FOLDER });
        if (folderId) {
            csvFile.folder = Number(folderId);
            csvFile.save();
        }

        context.response.addHeader({
            name: 'Content-Disposition',
            value: 'attachment; filename="' + fileName + '"'
        });
        context.response.writeFile({ file: csvFile, isInline: false });
    }

    function readHeader(request) {
        return {
            subsidiary: required(request.parameters[IDS.FORM.SUBSIDIARY], 'Subsidiary'),
            apAccount: required(request.parameters[IDS.FORM.AP_ACCOUNT], 'A/P Account'),
            bankAccount: required(request.parameters[IDS.FORM.BANK_ACCOUNT], 'Bank Account'),
            paymentDate: parseNsDate(required(request.parameters[IDS.FORM.PAYMENT_DATE], 'Payment Date')),
            postingPeriod: request.parameters[IDS.FORM.POSTING_PERIOD] || '',
            memo: request.parameters[IDS.FORM.MEMO] || '',
            paymentType: request.parameters[IDS.FORM.PAYMENT_TYPE] || '2'
        };
    }

    function readSelectedBills(request) {
        const count = request.getLineCount({ group: IDS.SUBLIST });
        const selected = [];

        for (let line = 0; line < count; line += 1) {
            const apply = request.getSublistValue({
                group: IDS.SUBLIST,
                name: IDS.LINE.APPLY,
                line
            });
            if (apply !== 'T') continue;

            const amountDue = toNumber(request.getSublistValue({
                group: IDS.SUBLIST,
                name: IDS.LINE.DUE,
                line
            }));
            const paymentAmount = toNumber(request.getSublistValue({
                group: IDS.SUBLIST,
                name: IDS.LINE.PAYMENT,
                line
            }));

            if (paymentAmount <= 0) {
                throw error.create({
                    name: 'INVALID_PAYMENT_AMOUNT',
                    message: 'Payment amount must be greater than zero on selected line ' + (line + 1) + '.'
                });
            }
            if (paymentAmount > amountDue + 0.00001) {
                throw error.create({
                    name: 'PAYMENT_EXCEEDS_DUE',
                    message: 'Payment exceeds amount due on selected line ' + (line + 1) + '.'
                });
            }

            selected.push({
                billId: request.getSublistValue({
                    group: IDS.SUBLIST,
                    name: IDS.LINE.BILL_ID,
                    line
                }),
                vendorId: request.getSublistValue({
                    group: IDS.SUBLIST,
                    name: IDS.LINE.VENDOR_ID,
                    line
                }),
                currencyText: request.getSublistValue({
                    group: IDS.SUBLIST,
                    name: IDS.LINE.CURRENCY,
                    line
                }) || '',
                tranid: request.getSublistValue({
                    group: IDS.SUBLIST,
                    name: IDS.LINE.TRANID,
                    line
                }) || '',
                amountDue,
                paymentAmount
            });
        }
        return selected;
    }

    function groupBills(lines) {
        return lines.reduce((groups, line) => {
            const key = line.vendorId + '|' + line.currencyText;
            if (!groups[key]) {
                groups[key] = {
                    vendorId: line.vendorId,
                    currencyText: line.currencyText,
                    bills: [],
                    total: 0
                };
            }
            groups[key].bills.push(line);
            groups[key].total += line.paymentAmount;
            return groups;
        }, {});
    }

    function createVendorPayment(header, group) {
        const payment = record.create({
            type: record.Type.VENDOR_PAYMENT,
            isDynamic: true,
            defaultValues: {
                entity: group.vendorId
            }
        });

        payment.setValue({ fieldId: 'entity', value: Number(group.vendorId) });

        const sourcedSubsidiary = String(payment.getValue({ fieldId: 'subsidiary' }) || '');
        if (sourcedSubsidiary && sourcedSubsidiary !== String(header.subsidiary)) {
            throw error.create({
                name: 'VENDOR_SUBSIDIARY_MISMATCH',
                message:
                    'Vendor ' + group.vendorId + ' belongs to subsidiary ' +
                    sourcedSubsidiary + ', not selected subsidiary ' + header.subsidiary + '.'
            });
        }

        payment.setValue({ fieldId: 'account', value: Number(header.bankAccount) });
        payment.setValue({ fieldId: 'apacct', value: Number(header.apAccount) });
        payment.setValue({ fieldId: 'trandate', value: header.paymentDate });

        if (header.postingPeriod) {
            payment.setValue({ fieldId: 'postingperiod', value: Number(header.postingPeriod) });
        }
        if (header.memo) {
            payment.setValue({ fieldId: 'memo', value: header.memo });
        }

        const wanted = {};
        group.bills.forEach(bill => {
            wanted[String(bill.billId)] = bill.paymentAmount;
        });

        const lineCount = payment.getLineCount({ sublistId: 'apply' });
        let appliedCount = 0;

        for (let line = 0; line < lineCount; line += 1) {
            payment.selectLine({ sublistId: 'apply', line });
            const docId = String(payment.getCurrentSublistValue({
                sublistId: 'apply',
                fieldId: 'internalid'
            }) || payment.getCurrentSublistValue({
                sublistId: 'apply',
                fieldId: 'doc'
            }) || '');

            if (Object.prototype.hasOwnProperty.call(wanted, docId)) {
                payment.setCurrentSublistValue({
                    sublistId: 'apply',
                    fieldId: 'apply',
                    value: true
                });
                payment.setCurrentSublistValue({
                    sublistId: 'apply',
                    fieldId: 'amount',
                    value: wanted[docId]
                });
                appliedCount += 1;
            }
            payment.commitLine({ sublistId: 'apply' });
        }

        if (appliedCount !== group.bills.length) {
            throw error.create({
                name: 'BILL_NOT_AVAILABLE_TO_APPLY',
                message:
                    'Only ' + appliedCount + ' of ' + group.bills.length +
                    ' selected bills were available on the Vendor Payment apply sublist for vendor ' +
                    group.vendorId + '. No payment was saved.'
            });
        }

        return payment.save({
            enableSourcing: true,
            ignoreMandatoryFields: false
        });
    }

function testFallback(actualValue, dummyValue) {
    const actual = String(
        actualValue == null ? '' : actualValue
    ).trim();

    if (actual) {
        return actual;
    }

    return USE_DUMMY_BANK_DATA
        ? String(dummyValue || '').trim()
        : '';
}

    function buildPaymentCsvData(header, group, paymentId) {
        const config = getFieldConfig();
        const vendor = loadConfiguredValues(record.Type.VENDOR, group.vendorId, [
            config.vendorBeneficiaryAccount,
            config.vendorBeneficiaryCurrency,
            config.vendorBeneficiaryName,
            config.vendorAddress1,
            config.vendorAddress2,
            config.vendorAddress3,
            config.vendorCodeType,
            config.vendorBankCode,
            config.vendorCharges,
            config.vendorPurpose,
            config.vendorAccountType,
'entityid',
'companyname'
        ]);

const bankAccountRecord = record.load({
    type: record.Type.ACCOUNT,
    id: Number(header.bankAccount),
    isDynamic: false
});

const bank = {};

if (config.bankRemitterAccount) {
    bank[config.bankRemitterAccount] =
        bankAccountRecord.getValue({
            fieldId: config.bankRemitterAccount
        }) || '';
}

if (config.bankCurrency) {
    bank[config.bankCurrency] =
        bankAccountRecord.getValue({
            fieldId: config.bankCurrency
        }) || '';
}

const detectedCurrency = firstNonBlank(
    valueOf(
        vendor,
        config.vendorBeneficiaryCurrency
    ),
    isoFromDisplay(group.currencyText)
);

const currency = testFallback(
    detectedCurrency,
    DUMMY_BANK_DATA.beneficiaryCurrency
);

const remitterCurrency = testFallback(
    valueOf(bank, config.bankCurrency),
    DUMMY_BANK_DATA.remitterCurrency
);

const beneficiaryName = testFallback(
    firstNonBlank(
        valueOf(
            vendor,
            config.vendorBeneficiaryName
        ),
        valueOf(vendor, 'companyname'),
        valueOf(vendor, 'entityid')
    ),
    DUMMY_BANK_DATA.beneficiaryName
);

const remitterAccount = testFallback(
    valueOf(
        bank,
        config.bankRemitterAccount
    ),
    DUMMY_BANK_DATA.remitterAccount
);

const beneficiaryAccount = testFallback(
    valueOf(
        vendor,
        config.vendorBeneficiaryAccount
    ),
    DUMMY_BANK_DATA.beneficiaryAccount
);

const beneficiaryAddress1 = testFallback(
    valueOf(
        vendor,
        config.vendorAddress1
    ),
    DUMMY_BANK_DATA.beneficiaryAddress1
);

const beneficiaryAddress2 = testFallback(
    valueOf(
        vendor,
        config.vendorAddress2
    ),
    DUMMY_BANK_DATA.beneficiaryAddress2
);

const beneficiaryAddress3 = testFallback(
    valueOf(
        vendor,
        config.vendorAddress3
    ),
    DUMMY_BANK_DATA.beneficiaryAddress3
);

const codeType = testFallback(
    valueOf(
        vendor,
        config.vendorCodeType
    ),
    DUMMY_BANK_DATA.codeType
);

const bankCode = testFallback(
    valueOf(
        vendor,
        config.vendorBankCode
    ),
    DUMMY_BANK_DATA.bankCode
);

const charges = testFallback(
    valueOf(
        vendor,
        config.vendorCharges
    ),
    DUMMY_BANK_DATA.charges
);

const purposeCode = testFallback(
    valueOf(
        vendor,
        config.vendorPurpose
    ),
    DUMMY_BANK_DATA.purposeCode
);

const achAccountType = testFallback(
    valueOf(
        vendor,
        config.vendorAccountType
    ),
    DUMMY_BANK_DATA.achAccountType
);

        const paymentDetails = ('NS Payment ' + paymentId + ' ' +
            group.bills.map(b => b.tranid).join(' ')).trim();

 const data = [
    header.paymentType,                         // 1 Payment Type
    yyyymmdd(header.paymentDate),               // 2 Payment Date
    remitterAccount,                            // 3 Remitter Account
    remitterCurrency,                           // 4 Remitter Currency
    group.total.toFixed(2),                     // 5 Transfer Amount
    currency,                                   // 6 Transfer Currency
    beneficiaryAccount,                        // 7 Beneficiary Account
    currency,                                   // 8 Beneficiary Account Currency
    beneficiaryName,                            // 9 Beneficiary Name
    beneficiaryAddress1,                        // 10 Address 1
    beneficiaryAddress2,                        // 11 Address 2
    beneficiaryAddress3,                        // 12 Address 3
    codeType,                                   // 13 Code Type
    bankCode,                                   // 14 Bank Code
    paymentDetails.substring(0, 35),            // 15 Payment Details 1
    paymentDetails.substring(35, 70),           // 16 Payment Details 2
    paymentDetails.substring(70, 105),          // 17 Payment Details 3
    paymentDetails.substring(105, 140),         // 18 Payment Details 4
    charges,                                    // 19 Charges
    purposeCode,                                // 20 Purpose Code
    '',                                         // 21 Beneficiary Bank Name
    '',                                         // 22 Bank Address 1
    '',                                         // 23 Bank Address 2
    '',                                         // 24 Bank Address 3
    '',                                         // 25 Bank Address 4
    header.paymentType === '2'
        ? achAccountType
        : ''                                    // 26 ACH Account Type
];

        validateCsvData(data, header.paymentType, group.vendorId);
        return data;
    }

    function getFieldConfig() {
        const script = runtime.getCurrentScript();
        const get = name => String(script.getParameter({ name }) || '').trim();

        return {
            vendorBeneficiaryAccount: get(IDS.PARAM.V_BEN_ACCT),
            vendorBeneficiaryCurrency: get(IDS.PARAM.V_BEN_CURRENCY),
            vendorBeneficiaryName: get(IDS.PARAM.V_BEN_NAME),
            vendorAddress1: get(IDS.PARAM.V_ADDR1),
            vendorAddress2: get(IDS.PARAM.V_ADDR2),
            vendorAddress3: get(IDS.PARAM.V_ADDR3),
            vendorCodeType: get(IDS.PARAM.V_CODE_TYPE),
            vendorBankCode: get(IDS.PARAM.V_BANK_CODE),
            vendorCharges: get(IDS.PARAM.V_CHARGES),
            vendorPurpose: get(IDS.PARAM.V_PURPOSE),
            vendorAccountType: get(IDS.PARAM.V_ACCT_TYPE),
            bankRemitterAccount: get(IDS.PARAM.BANK_REMITTER),
            bankCurrency: get(IDS.PARAM.BANK_CURRENCY)
        };
    }

    function loadConfiguredValues(type, id, fieldIds) {
        const unique = [...new Set(fieldIds.filter(Boolean))];
        if (!unique.length) return {};
        return search.lookupFields({
            type,
            id: Number(id),
            columns: unique
        });
    }

    function validateCsvData(data, paymentType, vendorId) {
        if (data.length !== CSV_COLUMN_COUNT) {
            throw error.create({
                name: 'CSV_COLUMN_ERROR',
                message: 'Expected ' + CSV_COLUMN_COUNT + ' CSV columns but generated ' + data.length + '.'
            });
        }

        const requiredIndexes = [0, 1, 2, 3, 4, 5, 6, 7, 8, 12, 13, 18];
        if (paymentType === '2') {
            requiredIndexes.push(9, 10, 11, 25);
        }

        const missing = requiredIndexes
            .filter(index => !String(data[index] || '').trim())
            .map(index => index + 1);

        if (missing.length) {
            throw error.create({
                name: 'MISSING_BANK_DATA',
                message:
                    'Vendor ' + vendorId +
                    ' is missing required bank-export values for CSV column(s): ' +
                    missing.join(', ') +
                    '. Configure the deployment parameters and populate the related vendor/account fields.'
            });
        }

        if (!/^[0-6]$/.test(String(data[0]))) {
            throw error.create({ name: 'INVALID_PAYMENT_TYPE', message: 'Payment Type must be 0 through 6.' });
        }
        if (!/^\d{8}$/.test(String(data[1]))) {
            throw error.create({ name: 'INVALID_PAYMENT_DATE', message: 'Payment Date must be YYYYMMDD.' });
        }
        if (!/^\d+(\.\d{2})$/.test(String(data[4]))) {
            throw error.create({ name: 'INVALID_TRANSFER_AMOUNT', message: 'Transfer Amount must contain two decimals.' });
        }
        if (!/^[A-Z]{3}$/.test(String(data[3])) || !/^[A-Z]{3}$/.test(String(data[5])) ||
            !/^[A-Z]{3}$/.test(String(data[7]))) {
            throw error.create({
                name: 'INVALID_CURRENCY',
                message: 'Remitter, transfer, and beneficiary currencies must be three-letter ISO codes.'
            });
        }
        if (!/^[0-6]$/.test(String(data[12]))) {
            throw error.create({ name: 'INVALID_CODE_TYPE', message: 'Vendor bank Code Type must be 0 through 6.' });
        }
        if (!/^(SHA|BEN|OUR)$/.test(String(data[18]))) {
            throw error.create({ name: 'INVALID_CHARGES', message: 'Charges must be SHA, BEN, or OUR.' });
        }
        if (paymentType === '2' && !/^(CH|SA|LN)$/.test(String(data[25]))) {
            throw error.create({
                name: 'INVALID_ACH_ACCOUNT_TYPE',
                message: 'ACH beneficiary account type must be CH, SA, or LN.'
            });
        }
    }

    function buildCsvRow(values) {
        return values.map(csvEscape).join(',');
    }

    function csvEscape(value) {
        const text = String(value == null ? '' : value)
            .replace(/[\r\n]+/g, ' ')
            .trim();
        return /[",]/.test(text) ? '"' + text.replace(/"/g, '""') + '"' : text;
    }

    function valueOf(obj, fieldId) {
        if (!fieldId || !obj || obj[fieldId] == null) return '';
        const value = obj[fieldId];
        if (Array.isArray(value)) {
            return value.length ? String(value[0].value || value[0].text || '') : '';
        }
        return String(value);
    }

    function textOf(obj, fieldId) {
        if (!fieldId || !obj || obj[fieldId] == null) return '';
        const value = obj[fieldId];
        if (Array.isArray(value)) {
            return value.length ? String(value[0].text || value[0].value || '') : '';
        }
        return String(value);
    }

    function firstNonBlank(...values) {
        return values.find(v => String(v || '').trim()) || '';
    }

    function isoFromDisplay(text) {
        const match = String(text || '').toUpperCase().match(/\(([A-Z]{3})\)/);
        if (match) return match[1];
        const direct = String(text || '').trim().toUpperCase();
        return /^[A-Z]{3}$/.test(direct) ? direct : '';
    }

    function yyyymmdd(date) {
        const year = date.getFullYear();
        const month = String(date.getMonth() + 1).padStart(2, '0');
        const day = String(date.getDate()).padStart(2, '0');
        return String(year) + month + day;
    }

    function timestampForFile(date) {
        return yyyymmdd(date) + '_' +
            String(date.getHours()).padStart(2, '0') +
            String(date.getMinutes()).padStart(2, '0') +
            String(date.getSeconds()).padStart(2, '0');
    }

    function parseNsDate(value) {
        return format.parse({ value, type: format.Type.DATE });
    }

    function required(value, label) {
        if (!value) {
            throw error.create({ name: 'MISSING_' + label.toUpperCase().replace(/\W+/g, '_'), message: label + ' is required.' });
        }
        return value;
    }

    function toNumber(value) {
        const number = Number(String(value == null ? '' : value).replace(/,/g, ''));
        return Number.isFinite(number) ? number : 0;
    }

    function formatMoney(value) {
        return Number(value || 0).toFixed(2);
    }

    function setSublistValue(sublist, id, line, value) {
        if (value === '' || value == null) return;
        sublist.setSublistValue({ id, line, value: String(value) });
    }

function buildClientScript() {
    return `
<script>
function refreshBills() {
    try {
        var actionField =
            document.getElementById('custpage_action');

        if (!actionField) {
            alert(
                'Unable to locate the Suitelet action field.'
            );
            return false;
        }

        actionField.value = 'refresh';

        window.onbeforeunload = null;

        var form =
            document.forms['main_form'] ||
            document.forms[0];

        if (!form) {
            alert(
                'Unable to locate the Suitelet form.'
            );
            return false;
        }

        form.submit();
        return false;

    } catch (e) {
        alert(
            'Refresh Bills failed: ' +
            (e.message || e)
        );

        return false;
    }
}
</script>`;
}

    function renderError(context, e) {
        const message = (e && e.message) ? e.message : String(e);
        if (context.request.method === 'GET') {
            renderForm(context, 'Error: ' + message);
            return;
        }

        const form = serverWidget.createForm({ title: 'Bill Payments - Error' });
        const field = form.addField({
            id: 'custpage_error',
            label: 'Error',
            type: serverWidget.FieldType.INLINEHTML
        });
        field.defaultValue =
            '<div style="padding:14px;border:1px solid #b94a48;background:#fbeaea;color:#8a1f1f;">' +
            '<strong>Payment was not completed.</strong><br>' +
            escapeHtml(message) +
            '</div>';
        form.addButton({
            id: 'custpage_back',
            label: 'Back',
            functionName: 'history.back'
        });
        context.response.writePage(form);
    }

    function escapeHtml(value) {
        return String(value == null ? '' : value)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    }

    return { onRequest };
});
