/**
 * @NApiVersion 2.1
 * @NScriptType Suitelet
 */
define(['N/ui/serverWidget', 'N/search'], (
    serverWidget,
    search
) => {
    const MAX_RESULTS = 500;

    const onRequest = (context) => {
        const customerId = context.request.parameters.customer;

        const form = serverWidget.createForm({
            title: 'Last Purchased Items'
        });

        const htmlField = form.addField({
            id: 'custpage_html',
            type: serverWidget.FieldType.INLINEHTML,
            label: 'HTML'
        });

        if (!customerId) {
            htmlField.defaultValue = buildMessageHtml(
                'No customer was provided. Please close this window, select a customer on the Sales Order, and try again.'
            );
            context.response.writePage(form);
            return;
        }

        const items = getLastPurchasedItems(customerId);

        htmlField.defaultValue = buildHtml(items);

        context.response.writePage(form);
    };

    const getLastPurchasedItems = (customerId) => {
        const itemCol = search.createColumn({
            name: 'item',
            summary: search.Summary.GROUP
        });

        const lastDateCol = search.createColumn({
            name: 'trandate',
            summary: search.Summary.MAX,
            sort: search.Sort.DESC
        });

        const qtyCol = search.createColumn({
            name: 'quantity',
            summary: search.Summary.SUM
        });

        const amountCol = search.createColumn({
            name: 'amount',
            summary: search.Summary.SUM
        });

        const orderCountCol = search.createColumn({
            name: 'internalid',
            summary: search.Summary.COUNT
        });

        const displayNameCol = search.createColumn({
            name: 'displayname',
            join: 'item',
            summary: search.Summary.GROUP
        });

        const salesDescriptionCol = search.createColumn({
            name: 'salesdescription',
            join: 'item',
            summary: search.Summary.GROUP
        });

        const itemTypeCol = search.createColumn({
            name: 'type',
            join: 'item',
            summary: search.Summary.GROUP
        });

        const basePriceCol = search.createColumn({
            name: 'baseprice',
            join: 'item',
            summary: search.Summary.GROUP
        });

        const availableCol = search.createColumn({
            name: 'quantityavailable',
            join: 'item',
            summary: search.Summary.MAX
        });

        const transactionSearch = search.create({
            type: search.Type.TRANSACTION,
            filters: [
                ['type', 'anyof', 'CustInvc', 'CashSale'],
                'AND',
                ['entity', 'anyof', customerId],
                'AND',
                ['mainline', 'is', 'F'],
                'AND',
                ['taxline', 'is', 'F'],
                'AND',
                ['shipping', 'is', 'F'],
                'AND',
                ['cogs', 'is', 'F'],
                'AND',
                ['item', 'noneof', '@NONE@']
            ],
            columns: [
                itemCol,
                lastDateCol,
                qtyCol,
                amountCol,
                orderCountCol,
                displayNameCol,
                salesDescriptionCol,
                itemTypeCol,
                basePriceCol,
                availableCol
            ]
        });

        const results = [];

        transactionSearch.run().each((result) => {
            if (results.length >= MAX_RESULTS) {
                return false;
            }

            const itemId = result.getValue(itemCol);
            const itemText = result.getText(itemCol) || '';

            if (!itemId) {
                return true;
            }

            results.push({
                itemId,
                itemText,
                displayName: result.getValue(displayNameCol) || '',
                description: result.getValue(salesDescriptionCol) || '',
                itemType: result.getText(itemTypeCol) || result.getValue(itemTypeCol) || '',
                lastPurchased: result.getValue(lastDateCol) || '',
                totalQty: result.getValue(qtyCol) || '',
                totalAmount: result.getValue(amountCol) || '',
                orderCount: result.getValue(orderCountCol) || '',
                basePrice: result.getValue(basePriceCol) || '',
                available: result.getValue(availableCol) || ''
            });

            return true;
        });

        return results;
    };

    const buildMessageHtml = (message) => {
        return `
            <div style="font-family: Arial, sans-serif; padding: 20px;">
                <h2>Last Purchased Items</h2>
                <p>${escapeHtml(message)}</p>
            </div>
        `;
    };

    const buildHtml = (items) => {
        const rowsHtml = items.length
            ? items.map((item, index) => buildRowHtml(item, index)).join('')
            : `
                <tr>
                    <td colspan="10" style="padding: 20px; text-align: center;">
                        No previously purchased items were found for this customer.
                    </td>
                </tr>
            `;

        return `
            <style>
                body {
                    font-family: Arial, Helvetica, sans-serif;
                    font-size: 13px;
                }

                .lp-toolbar {
                    margin: 12px 0;
                    display: flex;
                    gap: 8px;
                    align-items: center;
                }

                .lp-button {
                    background: #0073aa;
                    color: white;
                    border: 1px solid #005f8f;
                    padding: 6px 12px;
                    border-radius: 3px;
                    cursor: pointer;
                    font-size: 13px;
                }

                .lp-button-secondary {
                    background: #f2f2f2;
                    color: #333;
                    border: 1px solid #bbb;
                    padding: 6px 12px;
                    border-radius: 3px;
                    cursor: pointer;
                    font-size: 13px;
                }

                .lp-search {
                    padding: 6px;
                    width: 300px;
                    border: 1px solid #aaa;
                    border-radius: 3px;
                }

                table.lp-table {
                    width: 100%;
                    border-collapse: collapse;
                    margin-top: 10px;
                }

                .lp-table th {
                    background: #e5e5e5;
                    border: 1px solid #ccc;
                    padding: 6px;
                    text-align: left;
                    white-space: nowrap;
                }

                .lp-table td {
                    border: 1px solid #ddd;
                    padding: 5px;
                    vertical-align: top;
                }

                .lp-table tr:nth-child(even) {
                    background: #fafafa;
                }

                .lp-qty {
                    width: 70px;
                    padding: 4px;
                }

                .lp-small {
                    color: #666;
                    font-size: 12px;
                }

                .lp-item-name {
                    font-weight: bold;
                }

                .lp-description {
                    color: #444;
                    margin-top: 2px;
                }
            </style>

            <div>
                <h2 style="margin-bottom: 4px;">Last Purchased Items</h2>
                <div class="lp-small">
                    Items are sorted by most recent Sales Order date. Enter quantities and click Add Selected.
                </div>

                <div class="lp-toolbar">
                    <button type="button" class="lp-button" onclick="addSelectedItems()">Add Selected</button>
                    <button type="button" class="lp-button-secondary" onclick="window.close()">Close</button>
                    <input
                        type="text"
                        id="lp_filter"
                        class="lp-search"
                        placeholder="Filter items..."
                        onkeyup="filterRows()"
                    />
                    <span class="lp-small">${items.length} item(s)</span>
                </div>

                <table class="lp-table" id="lp_table">
                    <thead>
                        <tr>
                            <th>Add</th>
                            <th>Quantity</th>
                            <th>Item</th>
                            <th>Description</th>
                            <th>Type</th>
                            <th>Last Purchased</th>
                            <th>Total Qty</th>
                            <th>Orders</th>
                            <th>Base Price</th>
                            <th>Available</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${rowsHtml}
                    </tbody>
                </table>
            </div>

            <script>
                function filterRows() {
                    var filter = document.getElementById('lp_filter').value.toLowerCase();
                    var rows = document.querySelectorAll('#lp_table tbody tr');

                    rows.forEach(function(row) {
                        var text = row.innerText.toLowerCase();
                        row.style.display = text.indexOf(filter) >= 0 ? '' : 'none';
                    });
                }

                function addSelectedItems() {
                    var selected = [];
                    var rows = document.querySelectorAll('#lp_table tbody tr[data-itemid]');

                    rows.forEach(function(row) {
                        var checkbox = row.querySelector('.lp-check');
                        var qtyInput = row.querySelector('.lp-qty');

                        if (!checkbox || !qtyInput) {
                            return;
                        }

                        var checked = checkbox.checked;
                        var qty = parseFloat(qtyInput.value || '0');

                        if (checked && qty > 0) {
                            selected.push({
                                itemId: row.getAttribute('data-itemid'),
                                quantity: qty
                            });
                        }
                    });

                    if (!selected.length) {
                        alert('Select at least one item and enter a quantity.');
                        return;
                    }

                    if (!window.opener || window.opener.closed) {
                        alert('The Sales Order window is not available. Please reopen this popup from the Sales Order.');
                        return;
                    }

                    window.opener.require(['N/currentRecord'], function(currentRecord) {
                        var rec = currentRecord.get();

                        selected.forEach(function(line) {
                            rec.selectNewLine({
                                sublistId: 'item'
                            });

                            rec.setCurrentSublistValue({
                                sublistId: 'item',
                                fieldId: 'item',
                                value: line.itemId,
                                forceSyncSourcing: true
                            });

                            rec.setCurrentSublistValue({
                                sublistId: 'item',
                                fieldId: 'quantity',
                                value: line.quantity,
                                forceSyncSourcing: true
                            });

                            rec.commitLine({
                                sublistId: 'item'
                            });
                        });

                        alert(selected.length + ' item(s) added to the Sales Order.');
                        window.close();
                    });
                }
            </script>
        `;
    };

    const buildRowHtml = (item, index) => {
        const description = item.description || item.displayName || '';

        return `
            <tr data-itemid="${escapeHtml(item.itemId)}">
                <td style="text-align:center;">
                    <input type="checkbox" class="lp-check" id="lp_check_${index}" />
                </td>
                <td>
                    <input
                        type="number"
                        class="lp-qty"
                        min="0"
                        step="1"
                        value=""
                        onchange="autoCheck(this)"
                        onkeyup="autoCheck(this)"
                    />
                </td>
                <td>
                    <label for="lp_check_${index}" class="lp-item-name">
                        ${escapeHtml(item.itemText)}
                    </label>
                </td>
                <td>
                    <div class="lp-description">${escapeHtml(description)}</div>
                </td>
                <td>${escapeHtml(item.itemType)}</td>
                <td>${escapeHtml(item.lastPurchased)}</td>
                <td>${escapeHtml(item.totalQty)}</td>
                <td>${escapeHtml(item.orderCount)}</td>
                <td>${escapeHtml(item.basePrice)}</td>
                <td>${escapeHtml(item.available)}</td>
            </tr>

            <script>
                function autoCheck(input) {
                    var row = input.closest('tr');
                    var check = row.querySelector('.lp-check');
                    var qty = parseFloat(input.value || '0');

                    if (qty > 0) {
                        check.checked = true;
                    }
                }
            </script>
        `;
    };

    const escapeHtml = (value) => {
        if (value === null || value === undefined) {
            return '';
        }

        return String(value)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#039;');
    };

    return {
        onRequest
    };
});