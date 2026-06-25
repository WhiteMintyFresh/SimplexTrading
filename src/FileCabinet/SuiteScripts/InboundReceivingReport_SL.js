/**
 * @NApiVersion 2.1
 * @NScriptType Suitelet
 *
 * Produces a letter-size portrait PDF receiving report for an Inbound Shipment.
 */
define(['N/record', 'N/render', 'N/format', 'N/log', 'N/search'], (record, render, format, log, search) => {
    const RECORD_TYPE = 'inboundshipment';
    const ITEM_SUBLIST = 'items';

    const xmlEscape = (value) => {
        if (value === null || value === undefined) return '';
        return String(value)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&apos;');
    };

    const safeValue = (rec, fieldId) => {
        try {
            return rec.getValue({ fieldId });
        } catch (e) {
            return '';
        }
    };

    const safeText = (rec, fieldId) => {
        try {
            return rec.getText({ fieldId }) || rec.getValue({ fieldId }) || '';
        } catch (e) {
            return safeValue(rec, fieldId);
        }
    };

    const safeSublistValue = (rec, fieldId, line) => {
        try {
            return rec.getSublistValue({
                sublistId: ITEM_SUBLIST,
                fieldId,
                line
            });
        } catch (e) {
            return '';
        }
    };

    const safeSublistText = (rec, fieldId, line) => {
        try {
            return rec.getSublistText({
                sublistId: ITEM_SUBLIST,
                fieldId,
                line
            }) || safeSublistValue(rec, fieldId, line);
        } catch (e) {
            return safeSublistValue(rec, fieldId, line);
        }
    };

    const formatDateTime = (value) => {
        if (!value) return '';
        if (Object.prototype.toString.call(value) !== '[object Date]') {
            return String(value);
        }

        try {
            return format.format({
                value,
                type: format.Type.DATETIMETZ
            });
        } catch (e) {
            return value.toLocaleString();
        }
    };

    const numberText = (value) => {
        if (value === null || value === undefined || value === '') return '';
        const number = Number(value);
        if (!Number.isFinite(number)) return String(value);
        return number.toLocaleString('en-US', {
            minimumFractionDigits: 0,
            maximumFractionDigits: 4
        });
    };

    const getLineCount = (rec) => {
        try {
            return rec.getLineCount({ sublistId: ITEM_SUBLIST });
        } catch (e) {
            return 0;
        }
    };

    const itemDescriptionCache = {};

    /**
     * shipmentitemdescription appears in the UI XML, but it is not always
     * returned by record.getSublistValue() on a loaded Inbound Shipment.
     * When that happens, retrieve the purchasing/sales description from the
     * referenced item record through an Item search.
     */
    const getItemDescription = (itemId) => {
        if (!itemId) return '';

        const cacheKey = String(itemId);
        if (Object.prototype.hasOwnProperty.call(itemDescriptionCache, cacheKey)) {
            return itemDescriptionCache[cacheKey];
        }

        let description = '';

        try {
            const itemSearch = search.create({
                type: search.Type.ITEM,
                filters: [
                    ['internalid', search.Operator.ANYOF, itemId]
                ],
                columns: [
                    search.createColumn({ name: 'purchasedescription' }),
                    search.createColumn({ name: 'salesdescription' }),
                    search.createColumn({ name: 'displayname' })
                ]
            });

            const result = itemSearch.run().getRange({
                start: 0,
                end: 1
            })[0];

            if (result) {
                description =
                    result.getValue({ name: 'purchasedescription' }) ||
                    result.getValue({ name: 'salesdescription' }) ||
                    result.getValue({ name: 'displayname' }) ||
                    '';
            }
        } catch (e) {
            log.error({
                title: `Unable to retrieve description for item ${itemId}`,
                details: e
            });
        }

        itemDescriptionCache[cacheKey] = description;
        return description;
    };

    const buildRows = (rec) => {
        const rows = [];
        const count = getLineCount(rec);

        for (let line = 0; line < count; line += 1) {
            const po = safeSublistText(rec, 'purchaseorder', line);
            const vendor = safeSublistText(rec, 'povendor', line);
            const item =
                safeSublistText(rec, 'shipmentitem', line) ||
                safeSublistValue(rec, 'shipmentitemtext', line);
            // Important:
            // `shipmentitem` is the Inbound Shipment Item record/line reference
            // (for example 3048), not the actual Inventory Item internal ID.
            // The actual item internal ID is exposed as `itemid` or
            // `shipmentitemkey` in the Inbound Shipment XML (for example 5986).
            const itemId =
                safeSublistValue(rec, 'itemid', line) ||
                safeSublistValue(rec, 'shipmentitemkey', line);

            const shipmentDescription =
                safeSublistValue(rec, 'shipmentitemdescription', line);
            const description =
                shipmentDescription ||
                getItemDescription(itemId);

            log.debug({
                title: `Receiving report line ${line + 1}`,
                details: {
                    itemId,
                    item,
                    shipmentDescription,
                    resolvedDescription: description
                }
            });

            const expected = safeSublistValue(rec, 'quantityexpected', line);

            rows.push(`
                <tr>
                    <td class="po">${xmlEscape(po)}</td>
                    <td class="vendor">${xmlEscape(vendor)}</td>
                    <td class="item">${xmlEscape(item)}</td>
                    <td class="description">${xmlEscape(description)}</td>
                    <td class="qty">${xmlEscape(numberText(expected))}</td>
                    <td class="received">&#160;</td>
                </tr>
            `);
        }

        if (!rows.length) {
            rows.push(`
                <tr>
                    <td colspan="6" class="empty">No shipment item lines were found.</td>
                </tr>
            `);
        }

        return rows.join('');
    };

    const buildPdfXml = (rec) => {
        const shipmentNumber =
            safeValue(rec, 'shipmentnumber') ||
            safeValue(rec, 'id') ||
            rec.id;
        const containerNumber =
            safeValue(rec, 'vesselnumber') ||
            safeValue(rec, 'externaldocumentnumber');
        const unstuffingDate = formatDateTime(
            safeValue(rec, 'custrecord_offloading_date')
        );

        return `<?xml version="1.0"?>
<!DOCTYPE pdf PUBLIC "-//big.faceless.org//report" "report-1.1.dtd">
<pdf>
<head>
    <style type="text/css">
        * {
            font-family: Helvetica, Arial, sans-serif;
        }
        body {
            font-size: 8pt;
            color: #111111;
        }
        .report-title {
            width: 100%;
            margin-bottom: 14px;
        }
        .report-title td {
            font-size: 13pt;
            text-align: center;
            font-weight: bold;
            padding: 0 0 8px 0;
        }
        table {
            width: 100%;
            border-collapse: collapse;
        }
        .summary-head td {
            background-color: #c9c9c9;
            font-weight: bold;
            font-size: 8pt;
            padding: 4px 8px;
        }
        .summary-values td {
            padding: 5px 8px 12px 8px;
            vertical-align: top;
            font-size: 8pt;
        }
        .signature-box {
            border: 1px solid #333333;
            height: 20px;
            width: 92px;
        }
        .items-head td {
            font-weight: bold;
            border-bottom: 1px solid #d8d8d8;
            padding: 5px 3px;
            font-size: 7pt;
        }
        .items-body td {
            border-bottom: 1px solid #dedede;
            padding: 5px 3px;
            vertical-align: top;
            font-size: 7pt;
        }
        .po { width: 12%; color: #111111; }
        .vendor { width: 10%; color: #777777; text-align: center; }
        .item { width: 18%; }
        .description {
            width: 30%;
            color: #8a8a8a;
            line-height: 9px;
            height: 20px;
            overflow: hidden;
        }
        .qty {
            width: 15%;
            text-align: center;
            font-weight: bold;
        }
        .received {
            width: 15%;
            border-left: 1px solid #cfcfcf;
            height: 25px;
            text-align: center;
        }
        .empty {
            text-align: center;
            padding: 20px;
            color: #777777;
        }
    </style>
</head>
<body size="Letter" margin="0.35in 0.35in 0.35in 0.35in">
    <table class="report-title">
        <tr>
            <td align="center" style="text-align: center;">Receiving Report</td>
        </tr>
    </table>

    <table>
        <tr class="summary-head">
            <td width="18%">Shipment #</td>
            <td width="18%">Container #</td>
            <td width="22%">Unstuffing Date/Time</td>
            <td width="21%">Signature</td>
            <td width="21%">Time Completed</td>
        </tr>
        <tr class="summary-values">
            <td>${xmlEscape(shipmentNumber)}</td>
            <td><b><i>${xmlEscape(containerNumber)}</i></b></td>
            <td>${xmlEscape(unstuffingDate)}</td>
            <td><div class="signature-box">&#160;</div></td>
            <td><div class="signature-box">&#160;</div></td>
        </tr>
    </table>

    <table>
        <thead>
            <tr class="items-head">
                <td class="po">PO</td>
                <td class="vendor">Vendor</td>
                <td class="item">Item</td>
                <td class="description">Description</td>
                <td class="qty" align="center">Quantity<br/>Expected</td>
                <td class="received" align="center">Quantity<br/>Received</td>
            </tr>
        </thead>
        <tbody class="items-body">
            ${buildRows(rec)}
        </tbody>
    </table>
</body>
</pdf>`;
    };

    const onRequest = (context) => {
        try {
            const shipmentId = context.request.parameters.shipmentid;
            if (!shipmentId || !/^\d+$/.test(String(shipmentId))) {
                throw new Error('A valid shipmentid parameter is required.');
            }

            const shipment = record.load({
                type: RECORD_TYPE,
                id: Number(shipmentId),
                isDynamic: false
            });

            const pdfFile = render.xmlToPdf({
                xmlString: buildPdfXml(shipment)
            });

            pdfFile.name =
                `Receiving_Report_${safeValue(shipment, 'shipmentnumber') || shipmentId}.pdf`;

            context.response.writeFile({
                file: pdfFile,
                isInline: true
            });
        } catch (e) {
            log.error({
                title: 'Inbound Shipment Receiving Report failed',
                details: e
            });

            context.response.statusCode = 500;
            context.response.write(
                `Unable to create receiving report: ${xmlEscape(e.message || e)}`
            );
        }
    };

    return { onRequest };
});
