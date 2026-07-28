/**
 * @NApiVersion 2.1
 * @NScriptType ClientScript
 *
 * Identifies the current browser/device, automatically registers unknown
 * devices, and defaults the assigned Register # on Cash Sales.
 */
define(
    ['N/search', 'N/record', 'N/ui/message'],
    (search, record, message) => {
        'use strict';

        const CONFIG = {
            DEBUG: true,
            SHOW_DEBUG_MESSAGES: true,

            REGISTER_FIELD_ID: 'custbody_register_number',
            DEVICE_ID_FIELD_ID: 'custbody_pos_device_id',

            MAPPING_RECORD_TYPE: 'customrecord_pos_device_register',
            MAPPING_DEVICE_FIELD_ID: 'custrecord_pos_device_id',
            MAPPING_REGISTER_FIELD_ID: 'custrecord_pos_register',

            /*
             * Set this to null when the custom record does not require
             * a manually entered Name.
             *
             * Example custom field:
             * custrecord_pos_device_name
             */
            MAPPING_NAME_FIELD_ID: null,

            LOCAL_STORAGE_KEY: 'netsuite_pos_device_id'
        };

        /**
         * Runs when the Cash Sale page initializes.
         *
         * @param {Object} context
         * @param {CurrentRecord} context.currentRecord
         * @param {string} context.mode
         */
        const pageInit = (context) => {
            debugLog('pageInit started', {
                mode: context.mode,
                recordType: context.currentRecord.type,
                recordId: context.currentRecord.id
            });

            try {
                if (!['create', 'copy'].includes(context.mode)) {
                    debugLog(
                        'Script stopped because mode is not create or copy',
                        {
                            mode: context.mode
                        }
                    );
                    return;
                }

                const transactionRecord = context.currentRecord;

                debugLog('Checking required transaction fields');

                validateTransactionField(
                    transactionRecord,
                    CONFIG.REGISTER_FIELD_ID
                );

                validateTransactionField(
                    transactionRecord,
                    CONFIG.DEVICE_ID_FIELD_ID
                );

                const deviceId = getOrCreateDeviceId();

                debugLog('Device ID determined', {
                    deviceId
                });

                transactionRecord.setValue({
                    fieldId: CONFIG.DEVICE_ID_FIELD_ID,
                    value: deviceId,
                    ignoreFieldChange: true
                });

                debugLog('Device ID placed on transaction', {
                    fieldId: CONFIG.DEVICE_ID_FIELD_ID,
                    deviceId
                });

                const currentRegister = transactionRecord.getValue({
                    fieldId: CONFIG.REGISTER_FIELD_ID
                });

                debugLog('Current Register value retrieved', {
                    currentRegister
                });

                if (currentRegister) {
                    debugLog(
                        'Register already populated; defaulting not required',
                        {
                            currentRegister
                        }
                    );
                    return;
                }

                let mapping = findMappingByDeviceId(deviceId);

                debugLog('Device mapping search completed', {
                    deviceId,
                    mapping
                });

                /*
                 * If the device does not exist, create the mapping record.
                 */
                if (!mapping) {
                    const mappingId = registerUnknownDevice(deviceId);

                    debugLog('Unknown device registered', {
                        deviceId,
                        mappingId
                    });

                    showWarning(
                        'New Device Registered',
                        [
                            'This device has been registered successfully.',
                            '',
                            `Device ID: ${deviceId}`,
                            `Mapping Record Internal ID: ${mappingId}`,
                            '',
                            'Open the Device/Register Mapping record and assign a Register.',
                            'After assigning the Register, refresh this Cash Sale.'
                        ].join('<br>')
                    );

                    return;
                }

                /*
                 * The mapping exists, but a register has not been assigned.
                 */
                if (!mapping.registerValue) {
                    debugLog('Device exists but has no assigned register', {
                        deviceId,
                        mappingId: mapping.mappingId
                    });

                    showWarning(
                        'Register Assignment Required',
                        [
                            'This device is registered, but it does not have a Register assigned.',
                            '',
                            `Device ID: ${deviceId}`,
                            `Mapping Record Internal ID: ${mapping.mappingId}`,
                            '',
                            'Assign a Register to the mapping record and refresh this Cash Sale.'
                        ].join('<br>')
                    );

                    return;
                }

                transactionRecord.setValue({
                    fieldId: CONFIG.REGISTER_FIELD_ID,
                    value: mapping.registerValue,
                    ignoreFieldChange: false,
                    forceSyncSourcing: true
                });

                const valueAfterSet = transactionRecord.getValue({
                    fieldId: CONFIG.REGISTER_FIELD_ID
                });

                const textAfterSet = safelyGetFieldText(
                    transactionRecord,
                    CONFIG.REGISTER_FIELD_ID
                );

                debugLog('Register successfully defaulted', {
                    mappingId: mapping.mappingId,
                    requestedValue: mapping.registerValue,
                    requestedText: mapping.registerText,
                    valueAfterSet,
                    textAfterSet
                });

                showDebugMessage(
                    'Register Defaulted',
                    `Device ${deviceId} defaulted to Register ${
                        textAfterSet ||
                        mapping.registerText ||
                        valueAfterSet
                    }.`
                );
            } catch (error) {
                errorLog('Unhandled pageInit error', error);

                showWarning(
                    'Register Defaulting Error',
                    buildErrorMessage(error)
                );
            }
        };

        /**
         * Confirms a transaction field is present on the current form.
         *
         * @param {CurrentRecord} transactionRecord
         * @param {string} fieldId
         */
        const validateTransactionField = (
            transactionRecord,
            fieldId
        ) => {
            const field = transactionRecord.getField({
                fieldId
            });

            if (!field) {
                throw new Error(
                    `Field "${fieldId}" is not available on the current transaction form.`
                );
            }

            debugLog('Transaction field is available', {
                fieldId,
                fieldType: field.type,
                isDisabled: field.isDisabled,
                isDisplay: field.isDisplay,
                isMandatory: field.isMandatory
            });
        };

        /**
         * Gets or creates the browser's persistent Device ID.
         *
         * @returns {string}
         */
        const getOrCreateDeviceId = () => {
            debugLog('Reading Device ID from localStorage', {
                localStorageKey: CONFIG.LOCAL_STORAGE_KEY
            });

            let deviceId;

            try {
                deviceId = window.localStorage.getItem(
                    CONFIG.LOCAL_STORAGE_KEY
                );
            } catch (error) {
                errorLog(
                    'Unable to read browser localStorage',
                    error
                );

                throw new Error(
                    'The browser blocked access to local storage. ' +
                    'Check browser privacy settings or private browsing mode.'
                );
            }

            if (deviceId) {
                debugLog(
                    'Existing Device ID found in localStorage',
                    {
                        deviceId
                    }
                );

                return deviceId;
            }

            deviceId = createUuid();

            debugLog('New Device ID generated', {
                deviceId
            });

            try {
                window.localStorage.setItem(
                    CONFIG.LOCAL_STORAGE_KEY,
                    deviceId
                );
            } catch (error) {
                errorLog(
                    'Unable to save Device ID to localStorage',
                    error
                );

                throw new Error(
                    'The browser blocked saving the Device ID to local storage.'
                );
            }

            debugLog('New Device ID saved to localStorage', {
                deviceId
            });

            return deviceId;
        };

        /**
         * Creates a UUID.
         *
         * @returns {string}
         */
        const createUuid = () => {
            if (
                window.crypto &&
                typeof window.crypto.randomUUID === 'function'
            ) {
                debugLog(
                    'Generating Device ID with crypto.randomUUID'
                );

                return window.crypto.randomUUID();
            }

            debugLog(
                'crypto.randomUUID unavailable; using fallback generator'
            );

            return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(
                /[xy]/g,
                (character) => {
                    const randomValue =
                        Math.floor(Math.random() * 16);

                    const value =
                        character === 'x'
                            ? randomValue
                            : (randomValue & 0x3) | 0x8;

                    return value.toString(16);
                }
            );
        };

        /**
         * Finds the mapping record for a Device ID.
         *
         * A mapping may exist without a Register assignment.
         *
         * @param {string} deviceId
         * @returns {{
         *     mappingId: string,
         *     registerValue: string|null,
         *     registerText: string|null
         * }|null}
         */
        const findMappingByDeviceId = (deviceId) => {
            debugLog('Starting device mapping search', {
                recordType: CONFIG.MAPPING_RECORD_TYPE,
                deviceField:
                    CONFIG.MAPPING_DEVICE_FIELD_ID,
                registerField:
                    CONFIG.MAPPING_REGISTER_FIELD_ID,
                deviceId
            });

            let mappingSearch;

            try {
                mappingSearch = search.create({
                    type: CONFIG.MAPPING_RECORD_TYPE,
                    filters: [
                        [
                            CONFIG.MAPPING_DEVICE_FIELD_ID,
                            search.Operator.IS,
                            deviceId
                        ],
                        'AND',
                        [
                            'isinactive',
                            search.Operator.IS,
                            'F'
                        ]
                    ],
                    columns: [
                        search.createColumn({
                            name: 'internalid'
                        }),
                        search.createColumn({
                            name:
                                CONFIG.MAPPING_REGISTER_FIELD_ID
                        })
                    ]
                });
            } catch (error) {
                errorLog(
                    'Unable to create mapping search',
                    error
                );

                throw new Error(
                    'Unable to create the device mapping search. ' +
                    'Verify the custom record and field IDs. ' +
                    buildErrorMessage(error)
                );
            }

            let results;

            try {
                results = mappingSearch.run().getRange({
                    start: 0,
                    end: 10
                });
            } catch (error) {
                errorLog(
                    'Unable to execute mapping search',
                    error
                );

                throw new Error(
                    'Unable to search device mappings. ' +
                    'Verify the role has permission to the custom record. ' +
                    buildErrorMessage(error)
                );
            }

            debugLog('Mapping search results returned', {
                resultCount: results ? results.length : 0
            });

            if (!results || results.length === 0) {
                return null;
            }

            if (results.length > 1) {
                debugLog(
                    'Multiple active mappings found; first result will be used',
                    {
                        deviceId,
                        resultCount: results.length
                    }
                );
            }

            const mappingId = results[0].getValue({
                name: 'internalid'
            });

            const registerValue =
                results[0].getValue({
                    name:
                        CONFIG.MAPPING_REGISTER_FIELD_ID
                }) || null;

            const registerText =
                results[0].getText({
                    name:
                        CONFIG.MAPPING_REGISTER_FIELD_ID
                }) || null;

            const mapping = {
                mappingId,
                registerValue,
                registerText
            };

            debugLog('Mapping result selected', mapping);

            return mapping;
        };

        /**
         * Creates an active mapping record for an unknown device.
         *
         * @param {string} deviceId
         * @returns {number|string} New mapping internal ID
         */
        const registerUnknownDevice = (deviceId) => {
            debugLog('Registering unknown device', {
                deviceId,
                recordType: CONFIG.MAPPING_RECORD_TYPE
            });

            /*
             * Search again immediately before creation to reduce the
             * possibility of duplicate records from multiple tabs.
             */
            const existingMapping =
                findMappingByDeviceId(deviceId);

            if (existingMapping) {
                debugLog(
                    'Mapping was created by another process',
                    existingMapping
                );

                return existingMapping.mappingId;
            }

            let mappingRecord;

            try {
                mappingRecord = record.create({
                    type: CONFIG.MAPPING_RECORD_TYPE,
                    isDynamic: false
                });

                mappingRecord.setValue({
    fieldId: 'name',
    value: `Device ${deviceId}`
});

                mappingRecord.setValue({
                    fieldId:
                        CONFIG.MAPPING_DEVICE_FIELD_ID,
                    value: deviceId
                });

                /*
                 * Only used when you have a separate custom Name field.
                 */
                if (CONFIG.MAPPING_NAME_FIELD_ID) {
                    mappingRecord.setValue({
                        fieldId:
                            CONFIG.MAPPING_NAME_FIELD_ID,
                        value: `Device ${deviceId}`
                    });
                }

                const mappingId = mappingRecord.save({
                    enableSourcing: true,
                    ignoreMandatoryFields: false
                });

                debugLog(
                    'Device mapping record successfully created',
                    {
                        mappingId,
                        deviceId
                    }
                );

                return mappingId;
            } catch (error) {
                errorLog(
                    'Unable to create device mapping record',
                    error
                );

                throw new Error(
                    'The Device ID was generated, but NetSuite could not ' +
                    'create the Device/Register Mapping record. Verify the ' +
                    'custom record permissions and mandatory fields. ' +
                    buildErrorMessage(error)
                );
            }
        };

        /**
         * Safely gets displayed field text.
         *
         * @param {CurrentRecord} transactionRecord
         * @param {string} fieldId
         * @returns {string|null}
         */
        const safelyGetFieldText = (
            transactionRecord,
            fieldId
        ) => {
            try {
                return transactionRecord.getText({
                    fieldId
                });
            } catch (error) {
                debugLog(
                    'Field text could not be retrieved',
                    {
                        fieldId,
                        error: buildErrorMessage(error)
                    }
                );

                return null;
            }
        };

        const debugLog = (title, details) => {
            if (!CONFIG.DEBUG) {
                return;
            }

            console.log(
                `[POS REGISTER] ${title}`,
                details === undefined ? '' : details
            );
        };

        const errorLog = (title, error) => {
            console.error(`[POS REGISTER] ${title}`, {
                name: error && error.name,
                message: error && error.message,
                stack: error && error.stack,
                fullError: error
            });
        };

        const showWarning = (title, text) => {
            message.create({
                title,
                message: text,
                type: message.Type.WARNING
            }).show({
                duration: 30000
            });
        };

        const showDebugMessage = (title, text) => {
            if (
                !CONFIG.DEBUG ||
                !CONFIG.SHOW_DEBUG_MESSAGES
            ) {
                return;
            }

            message.create({
                title,
                message: text,
                type: message.Type.INFORMATION
            }).show({
                duration: 10000
            });
        };

        const buildErrorMessage = (error) => {
            if (!error) {
                return 'Unknown error.';
            }

            const name = error.name
                ? `${error.name}: `
                : '';

            const text =
                error.message || String(error);

            return `${name}${text}`;
        };

        return {
            pageInit
        };
    }
);