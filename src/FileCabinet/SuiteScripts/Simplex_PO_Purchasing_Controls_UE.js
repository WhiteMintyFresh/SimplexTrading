/**
 * Simplex Trading Co Ltd - Purchase Order Value Approval
 *
 * MULTI-EMPLOYEE SANDBOX VERSION
 *
 * Approval is based only on:
 * - Purchase Type;
 * - the current Purchase Order total converted to BBD; and
 * - the Purchase Order header Department for Department Manager stages.
 *
 * Quote, RFQ, CapEx, board-evidence, procurement-method, effective-date,
 * and vendor/month cumulative controls are intentionally not enforced.
 *
 * @NApiVersion 2.1
 * @NScriptType UserEventScript
 */
define(['N/error'], (error) => {
    'use strict';

    const FIELD = Object.freeze({
        PURCHASE_TYPE: 'custbody_spx_pa_purchase_type',
        ROUTING_AMOUNT: 'custbody_spx_pa_routing_amt',
        REQUIRED_QUOTES: 'custbody_spx_pa_required_quotes',
        RFQ_REQUIRED: 'custbody_spx_pa_rfq_required',
        RULE_CODE: 'custbody_spx_pa_rule_code',
        ROUTE_SUMMARY: 'custbody_spx_pa_route_summary',
        CURRENT_APPROVER: 'custbody_spx_pa_dept_approver',
        SCM_APPROVER: 'custbody_spx_pa_scm_approver',
        CFO_APPROVER: 'custbody_spx_pa_cfo_approver',
        COO_APPROVER: 'custbody_spx_pa_coo_approver',
        CEO_APPROVER: 'custbody_spx_pa_ceo_approver'
    });

    const ROUTE = Object.freeze({
        INV_SCM: 'INV_SCM',
        INV_SCM_EXEC: 'INV_SCM_EXEC',
        INV_SCM_CEO: 'INV_SCM_CEO',
        GEN_DEPT: 'GEN_DEPT',
        GEN_DEPT_EXEC: 'GEN_DEPT_EXEC',
        GEN_EXEC: 'GEN_EXEC',
        GEN_EXEC_CEO: 'GEN_EXEC_CEO',
        GEN_CEO: 'GEN_CEO'
    });

    /*
     * Employee Internal IDs were reconciled against the supplied Sandbox
     * employee/role export. Jacob's export returned the special value -5,
     * so his Employee field is deliberately assigned by exact employee name.
     */
    const APPROVER = Object.freeze({
        SCM: Object.freeze({
            internalId: null,
            name: 'Jacob Lashley',
            email: 'jacob.lashley@simplextrading.net'
        }),
        CFO: Object.freeze({
            internalId: '1166',
            name: 'Roget Williams',
            email: 'roget.williams@simplextrading.net'
        }),
        COO: Object.freeze({
            internalId: '11',
            name: 'Matthew Hunte',
            email: 'matthew.hunte@simplextrading.net'
        }),
        CEO: Object.freeze({
            internalId: '4',
            name: 'Stuart Hunte',
            email: 'stuart.hunte@simplextrading.net'
        })
    });

    /*
     * Exact NetSuite Department Internal IDs from Departments688.csv.
     * ADMIN and HR intentionally use the COO as the available fallback.
     * IT follows Jan's org-chart reporting line through Kyden Hunte.
     */
    const DEPARTMENT_APPROVER = Object.freeze({
        '4': Object.freeze({
            department: 'ADMIN',
            internalId: '11',
            name: 'Matthew Hunte',
            basis: 'COO fallback for Administration'
        }),
        '12': Object.freeze({
            department: 'DIST - Distribution',
            internalId: '19',
            name: 'Dario Walters',
            basis: 'Deliveries Manager'
        }),
        '5': Object.freeze({
            department: 'FIN - Finance',
            internalId: '330',
            name: 'Juliet Ward',
            basis: 'Finance Manager'
        }),
        '10': Object.freeze({
            department: 'HR - Human Resources',
            internalId: '11',
            name: 'Matthew Hunte',
            basis: 'COO fallback; chart HR consultant is unavailable in Sandbox'
        }),
        '11': Object.freeze({
            department: 'IT - Information Technology',
            internalId: '3',
            name: 'Kyden Hunte',
            basis: 'Jan reporting line and active IT access'
        }),
        '7': Object.freeze({
            department: 'MKT - Marketing',
            internalId: '10',
            name: 'Kurt Hettgen',
            basis: 'Sales & Marketing Manager'
        }),
        '8': Object.freeze({
            department: 'PUR - Purchasing',
            internalId: '327',
            name: 'Arleigh Bascombe',
            basis: 'Purchasing Manager'
        }),
        '6': Object.freeze({
            department: 'SAL - Sales',
            internalId: '10',
            name: 'Kurt Hettgen',
            basis: 'Sales & Marketing Manager'
        }),
        '9': Object.freeze({
            department: 'SCM - Supply Chain',
            internalId: null,
            name: 'Jacob Lashley',
            basis: 'Interim Supply Chain Manager'
        }),
        '13': Object.freeze({
            department: 'WHSE - Warehousing',
            internalId: '19',
            name: 'Dario Walters',
            basis: 'Deliveries Manager / warehouse operations'
        })
    });

    const asNumber = (value) => {
        const parsed = Number(value);
        return Number.isFinite(parsed) ? parsed : 0;
    };

    const roundCurrency = (value) =>
        Math.round((asNumber(value) + Number.EPSILON) * 100) / 100;

    const normalize = (value) => String(value || '')
        .trim()
        .toLowerCase()
        .replace(/\s+/g, ' ');

    const getPurchaseTypeText = (record) => {
        try {
            return normalize(record.getText({
                fieldId: FIELD.PURCHASE_TYPE
            }));
        } catch (readError) {
            log.error({
                title: 'Unable to read Purchase Type',
                details: readError
            });
            return '';
        }
    };

    const getCurrentPoAmountBbd = (record) => {
        const transactionTotal = Math.abs(asNumber(
            record.getValue({ fieldId: 'total' })
        ));

        const rawExchangeRate = asNumber(
            record.getValue({ fieldId: 'exchangerate' })
        );

        const exchangeRate = rawExchangeRate > 0
            ? rawExchangeRate
            : 1;

        return roundCurrency(transactionTotal * exchangeRate);
    };

    const determineInventoryRoute = (amountBbd) => {
        if (amountBbd <= 25000) {
            return ROUTE.INV_SCM;
        }

        if (amountBbd <= 100000) {
            return ROUTE.INV_SCM_EXEC;
        }

        return ROUTE.INV_SCM_CEO;
    };

    const determineGeneralRoute = (amountBbd) => {
        if (amountBbd <= 10000) {
            return ROUTE.GEN_DEPT;
        }

        if (amountBbd <= 25000) {
            return ROUTE.GEN_DEPT_EXEC;
        }

        if (amountBbd <= 75000) {
            return ROUTE.GEN_EXEC;
        }

        if (amountBbd <= 150000) {
            return ROUTE.GEN_EXEC_CEO;
        }

        return ROUTE.GEN_CEO;
    };

    const determineRoute = (purchaseTypeText, amountBbd) => {
        if (purchaseTypeText.includes('inventory')) {
            return determineInventoryRoute(amountBbd);
        }

        if (
            purchaseTypeText.includes('general') ||
            purchaseTypeText.includes('expense') ||
            purchaseTypeText.includes('service')
        ) {
            return determineGeneralRoute(amountBbd);
        }

        throw error.create({
            name: 'SPX_PA_PURCHASE_TYPE_REQUIRED',
            message:
                'Select Inventory Purchase or General Expenses & Services ' +
                'in the Purchase Type field before saving the Purchase Order.',
            notifyOff: false
        });
    };

    const getDepartmentApprover = (record) => {
        const departmentId = String(
            record.getValue({ fieldId: 'department' }) || ''
        );

        if (!departmentId) {
            throw error.create({
                name: 'SPX_PA_DEPARTMENT_REQUIRED',
                message:
                    'Select a Department before saving a General Expense ' +
                    'or Services Purchase Order.',
                notifyOff: false
            });
        }

        const approver = DEPARTMENT_APPROVER[departmentId];

        if (!approver) {
            throw error.create({
                name: 'SPX_PA_DEPARTMENT_NOT_MAPPED',
                message:
                    `Department Internal ID ${departmentId} does not have ` +
                    'a purchasing approver in the User Event mapping.',
                notifyOff: false
            });
        }

        return approver;
    };

    const setEmployeeField = (record, fieldId, employee) => {
        if (employee.internalId) {
            record.setValue({
                fieldId,
                value: employee.internalId
            });
        } else {
            try {
                record.setText({
                    fieldId,
                    text: employee.name
                });
            } catch (setTextError) {
                log.error({
                    title: `Unable to select ${employee.name}`,
                    details: setTextError
                });

                throw error.create({
                    name: 'SPX_PA_APPROVER_ID_REQUIRED',
                    message:
                        `NetSuite could not select ${employee.name} in ` +
                        `${fieldId}. Open the employee record, copy its real ` +
                        'positive Internal ID, and add it to the User Event ' +
                        'APPROVER/DEPARTMENT_APPROVER mapping.',
                    notifyOff: false
                });
            }
        }

        const storedValue = record.getValue({ fieldId });

        if (!storedValue) {
            throw error.create({
                name: 'SPX_PA_APPROVER_NOT_SET',
                message:
                    `${employee.name} could not be stored in ${fieldId}. ` +
                    'Verify that the employee is active and selectable.',
                notifyOff: false
            });
        }
    };

    const getInitialApprover = (record, ruleCode) => {
        if (ruleCode.startsWith('INV_')) {
            return APPROVER.SCM;
        }

        if (
            ruleCode === ROUTE.GEN_DEPT ||
            ruleCode === ROUTE.GEN_DEPT_EXEC
        ) {
            return getDepartmentApprover(record);
        }

        if (
            ruleCode === ROUTE.GEN_EXEC ||
            ruleCode === ROUTE.GEN_EXEC_CEO
        ) {
            return APPROVER.CFO;
        }

        return APPROVER.CEO;
    };

    const buildRouteSummary = (record, ruleCode) => {
        switch (ruleCode) {
            case ROUTE.INV_SCM:
                return APPROVER.SCM.name;
            case ROUTE.INV_SCM_EXEC:
                return `${APPROVER.SCM.name} -> ` +
                    `${APPROVER.CFO.name} or ${APPROVER.COO.name}`;
            case ROUTE.INV_SCM_CEO:
                return `${APPROVER.SCM.name} -> ${APPROVER.CEO.name}`;
            case ROUTE.GEN_DEPT:
                return getDepartmentApprover(record).name;
            case ROUTE.GEN_DEPT_EXEC:
                return `${getDepartmentApprover(record).name} -> ` +
                    `${APPROVER.CFO.name} or ${APPROVER.COO.name}`;
            case ROUTE.GEN_EXEC:
                return `${APPROVER.CFO.name} or ${APPROVER.COO.name}`;
            case ROUTE.GEN_EXEC_CEO:
                return `${APPROVER.CFO.name} or ${APPROVER.COO.name} -> ` +
                    APPROVER.CEO.name;
            case ROUTE.GEN_CEO:
                return APPROVER.CEO.name;
            default:
                return '';
        }
    };

    const beforeSubmit = (context) => {
        if (
            context.type === context.UserEventType.DELETE ||
            context.type === context.UserEventType.XEDIT
        ) {
            return;
        }

        const record = context.newRecord;
        const purchaseTypeText = getPurchaseTypeText(record);
        const amountBbd = getCurrentPoAmountBbd(record);
        const ruleCode = determineRoute(purchaseTypeText, amountBbd);
        const initialApprover = getInitialApprover(record, ruleCode);
        const routeSummary = buildRouteSummary(record, ruleCode);

        setEmployeeField(
            record,
            FIELD.SCM_APPROVER,
            APPROVER.SCM
        );
        setEmployeeField(
            record,
            FIELD.CFO_APPROVER,
            APPROVER.CFO
        );
        setEmployeeField(
            record,
            FIELD.COO_APPROVER,
            APPROVER.COO
        );
        setEmployeeField(
            record,
            FIELD.CEO_APPROVER,
            APPROVER.CEO
        );
        setEmployeeField(
            record,
            FIELD.CURRENT_APPROVER,
            initialApprover
        );

        record.setValue({
            fieldId: FIELD.ROUTING_AMOUNT,
            value: amountBbd
        });

        // Quotes and RFQs remain manual and never block the PO.
        record.setValue({
            fieldId: FIELD.REQUIRED_QUOTES,
            value: 0
        });

        record.setValue({
            fieldId: FIELD.RFQ_REQUIRED,
            value: false
        });

        record.setValue({
            fieldId: FIELD.RULE_CODE,
            value: ruleCode
        });

        record.setValue({
            fieldId: FIELD.ROUTE_SUMMARY,
            value: routeSummary
        });

        log.audit({
            title: 'Simplex multi-employee PO route calculated',
            details: {
                poId: record.id || '(new)',
                departmentId: record.getValue({ fieldId: 'department' }),
                transactionTotal: record.getValue({ fieldId: 'total' }),
                exchangeRate: record.getValue({ fieldId: 'exchangerate' }),
                amountBbd,
                ruleCode,
                routeSummary,
                initialApprover: initialApprover.name
            }
        });
    };

    return {
        beforeSubmit
    };
});
