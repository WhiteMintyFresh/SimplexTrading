/**

 * @NApiVersion 2.0

 * @NScriptType Suitelet

 * @NModuleScope SameAccount

 */



define(['N/log', 'N/query', 'N/ui/serverWidget'], function(log, query, serverWidget) {

  function Abc(context) {

    var form = serverWidget.createForm({

      title: 'Abc - SuiteQL',

      hideNavBar: false

    })



    form.addSubmitButton({

      label: 'Submit'

    })



    var mainQuery = form.addField({

      id: 'custpage_main_query',

      type: serverWidget.FieldType.LONGTEXT,

      label: 'SQL Statement'

    })



    //for easier testing

    //mainQuery.defaultValue = 'SELECT * from CUSTOMER WHERE COMPANYNAME = \'xyz\''



    if (context.request.method == 'POST') {

      //retain query entered on the reponse page, this is outside the try loop so users are able to view the invalid query when it fails

      mainQuery.defaultValue = context.request.parameters.custpage_main_query;



      //Using try catch so the Suitelet doesn't crash when entering invalid sql statement

      try {

        //NetSuite limitation, LONGTEXT only can contain 100,000 characters

        /*

              var response = form.addField({

                id: 'custpage_response',

                type: serverWidget.FieldType.LONGTEXT,

                label: 'Response'

              })

        */



        var queryResults = query.runSuiteQL({

          query: context.request.parameters.custpage_main_query

        });



        var records = queryResults.asMappedResults();



        var resultsSublist = form.addSublist({

          id: 'results_sublist',

          label: 'Results',

          type: serverWidget.SublistType.LIST

        });



        var columnNames = Object.keys(records[0]);



        for (i = 0; i < columnNames.length; i++) {

          resultsSublist.addField({

            id: 'custpage_results_sublist_col_' + i,

            type: serverWidget.FieldType.TEXT,

            label: columnNames[i]

          });

        }



        for (r = 0; r < records.length; r++) {

          var record = records[r];



          for (c = 0; c < columnNames.length; c++) {

            var column = columnNames[c];

            var value = record[column];



            if (value != null) {

              value = value.toString();

            }



            resultsSublist.setSublistValue({

              id: 'custpage_results_sublist_col_' + c,

              line: r,

              value: value

            });

          }

        }



        //Using HTML to bypass the 100,000 character limit

        var resultLabelField = form.addField({

          id: 'custpage_results_label',

          type: serverWidget.FieldType.INLINEHTML,

          label: 'Result Label'

        });

        resultLabelField.defaultValue = "<p style='font-size:14px'>Result</p>";



        var temp = JSON.stringify(records, null, 3);

        var resultField = form.addField({

          id: 'custpage_results',

          type: serverWidget.FieldType.INLINEHTML,

          label: 'Result'

        });

        resultField.defaultValue = '<textarea id="cust_results" name="results" rows="20" cols="150">' + temp + '</textarea>';



      } catch (e) {



        var resultLabelField = form.addField({

          id: 'custpage_results_label',

          type: serverWidget.FieldType.INLINEHTML,

          label: 'Result Label'

        });

        resultLabelField.defaultValue = "<p style='font-size:14px'>Error</p>";



        var resultField = form.addField({

          id: 'custpage_results',

          type: serverWidget.FieldType.INLINEHTML,

          label: 'Result'

        });

        resultField.defaultValue = '<textarea id="cust_results" name="results" rows="20" cols="150">' + e.message + '</textarea>';



      }



    }

    context.response.writePage(form);

  }



  return {

    onRequest: Abc

  }

})