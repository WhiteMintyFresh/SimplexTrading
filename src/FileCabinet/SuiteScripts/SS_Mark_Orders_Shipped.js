/**
 * @NApiVersion 2.1
 * @NScriptType ScheduledScript
 */
define([
    'N/record',
    'N/runtime',
    'N/log'
], (
    record,
    runtime,
    log
) => {

    const RECORD_STATUS_SHIPPED = 'C';
    const PARAM_PAYLOAD = 'custscript_mos_payload';

    function execute() {
        const script = runtime.getCurrentScript();

        const payloadText = script.getParameter({
            name: PARAM_PAYLOAD
        }) || '[]';

        let payload = [];

        try {
            payload = JSON.parse(payloadText);
        } catch (e) {
            log.error({
                title: 'Invalid scheduled payload',
                details: e
            });
            return;
        }

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
                        shipstatus: RECORD_STATUS_SHIPPED
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
                    title: `Failed to mark fulfillment shipped: ${line.fulfillmentId}`,
                    details: e
                });
            }
        });

        log.audit({
            title: 'Mark Orders Shipped Complete',
            details: {
                total: payload.length,
                success,
                failed
            }
        });
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
                // Ignore unavailable package sublists.
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
            // Field may not exist on the carrier-specific package sublist.
        }
    }

    return {
        execute
    };
});