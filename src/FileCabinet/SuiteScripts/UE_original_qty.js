/**
 * @NApiVersion 2.1
 * @NScriptType UserEventScript
 */
define([], () => {
  const ORIGINAL_QTY_FIELD = 'custcol_original_qty';

  const beforeSubmit = (context) => {
    const rec = context.newRecord;

    if (!['create', 'copy', 'edit'].includes(context.type)) {
      return;
    }

    const lineCount = rec.getLineCount({ sublistId: 'item' });

    for (let i = 0; i < lineCount; i++) {
      const currentOriginalQty = rec.getSublistValue({
        sublistId: 'item',
        fieldId: ORIGINAL_QTY_FIELD,
        line: i
      });

      if (currentOriginalQty) {
        continue;
      }

      const nativeQty = rec.getSublistValue({
        sublistId: 'item',
        fieldId: 'quantity',
        line: i
      });

      if (nativeQty) {
        rec.setSublistValue({
          sublistId: 'item',
          fieldId: ORIGINAL_QTY_FIELD,
          line: i,
          value: nativeQty
        });
      }
    }
  };

  return { beforeSubmit };
});