/**
 * Simplex Trading Co Ltd - PO Inventory Department Defaulting
 *
 * Automatically sets the header Department to SCM - Supply Chain
 * whenever Purchase Type is Inventory Purchase.
 *
 * Purchase Type ID:
 * 1 = Inventory Purchase
 *
 * Department ID:
 * 9 = SCM - Supply Chain
 *
 * @NApiVersion 2.1
 * @NScriptType ClientScript
 */
define([], () => {
    'use strict';

    const FIELD = Object.freeze({
        PURCHASE_TYPE: 'custbody_spx_pa_purchase_type',
        DEPARTMENT: 'department'
    });

    const INVENTORY_PURCHASE_ID = '1';
    const SCM_DEPARTMENT_ID = '9';

    const defaultScmDepartment = (currentRecord) => {
        const purchaseType = String(
            currentRecord.getValue({
                fieldId: FIELD.PURCHASE_TYPE
            }) || ''
        );

        if (purchaseType !== INVENTORY_PURCHASE_ID) {
            return;
        }

        const currentDepartment = String(
            currentRecord.getValue({
                fieldId: FIELD.DEPARTMENT
            }) || ''
        );

        if (currentDepartment === SCM_DEPARTMENT_ID) {
            return;
        }

        currentRecord.setValue({
            fieldId: FIELD.DEPARTMENT,
            value: SCM_DEPARTMENT_ID,
            ignoreFieldChange: false,
            forceSyncSourcing: true
        });
    };

    const pageInit = (context) => {
        defaultScmDepartment(context.currentRecord);
    };

    const fieldChanged = (context) => {
        if (context.fieldId !== FIELD.PURCHASE_TYPE) {
            return;
        }

        defaultScmDepartment(context.currentRecord);
    };

    const saveRecord = (context) => {
        /*
         * Recheck during save so the user cannot accidentally leave an
         * Inventory Purchase assigned to another Department.
         */
        defaultScmDepartment(context.currentRecord);
        return true;
    };

    return {
        pageInit,
        fieldChanged,
        saveRecord
    };
});