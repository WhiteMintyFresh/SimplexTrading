/**
 * @NApiVersion 2.1
 * @NScriptType UserEventScript
 */
define(['N/record', 'N/search', 'N/log'], (record, search, log) => {
    const FIELD_IDS = {
        ETA: 'actualdeliverydate',
        SHIPPING_LINE: 'custrecord_shipping_line',
        LAST_FREE_DAY: 'custrecord_last_date'
    };

    const SHIPPING_LINE_RECORD = {
        TYPE: 'customrecord_shipping_line',
        FREE_DAYS_FIELD: 'custrecord_free_days'
    };

    /**
     * Calculates the final free day.
     *
     * Excel equivalent:
     * ETA + Free Days - 1
     * Saturday => previous Friday
     * Sunday   => previous Friday
     *
     * @param {Date} eta
     * @param {number} freeDays
     * @returns {Date|null}
     */
    const calculateLastFreeDay = (eta, freeDays) => {
        if (!(eta instanceof Date) || Number.isNaN(eta.getTime())) {
            return null;
        }

        const days = Number(freeDays);

        if (!Number.isFinite(days)) {
            return null;
        }

        const result = new Date(eta.getTime());
        result.setHours(12, 0, 0, 0);
        result.setDate(result.getDate() + days - 1);

        const dayOfWeek = result.getDay();

        // JavaScript: Sunday = 0, Saturday = 6
        if (dayOfWeek === 6) {
            result.setDate(result.getDate() - 1);
        } else if (dayOfWeek === 0) {
            result.setDate(result.getDate() - 2);
        }

        return result;
    };

    /**
     * Retrieves Free Days from the selected Shipping Line record.
     *
     * @param {string|number} shippingLineId
     * @returns {number|null}
     */
    const getFreeDays = shippingLineId => {
        if (!shippingLineId) {
            return null;
        }

        const lookup = search.lookupFields({
            type: SHIPPING_LINE_RECORD.TYPE,
            id: shippingLineId,
            columns: [SHIPPING_LINE_RECORD.FREE_DAYS_FIELD]
        });

        const value = lookup[SHIPPING_LINE_RECORD.FREE_DAYS_FIELD];

        if (value === null || value === undefined || value === '') {
            return null;
        }

        const freeDays = Number(value);

        return Number.isFinite(freeDays) ? freeDays : null;
    };

    const beforeSubmit = context => {
        try {
            if (
                context.type === context.UserEventType.DELETE ||
                context.type === context.UserEventType.XEDIT
            ) {
                return;
            }

            const shipment = context.newRecord;

            const eta = shipment.getValue({
                fieldId: FIELD_IDS.ETA
            });

            const shippingLineId = shipment.getValue({
                fieldId: FIELD_IDS.SHIPPING_LINE
            });

            if (!eta || !shippingLineId) {
                shipment.setValue({
                    fieldId: FIELD_IDS.LAST_FREE_DAY,
                    value: null
                });
                return;
            }

            const freeDays = getFreeDays(shippingLineId);
            const lastFreeDay = calculateLastFreeDay(eta, freeDays);

            shipment.setValue({
                fieldId: FIELD_IDS.LAST_FREE_DAY,
                value: lastFreeDay
            });
        } catch (error) {
            log.error({
                title: 'Unable to calculate Last Free Day',
                details: error
            });

            throw error;
        }
    };

    return {
        beforeSubmit
    };
});