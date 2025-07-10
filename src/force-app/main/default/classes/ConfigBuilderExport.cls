public class ConfigBuilderExport {

    	
    static String filter = '';// where LastModifiedDate >= LAST_N_WEEKS:2';
    static Map<String, Schema.SObjectField> objectsExtId = new Map<String, Schema.SObjectField>();
    static Map<String, Schema.SObjectField> objectsExtIdExcep = new Map<String, Schema.SObjectField>();
    //List of object which record  to be exported
    static List<String> objects = new List<String>{
        'SBQQ__QuoteTemplate__c','SBQQ__TemplateContent__c'
     };
        //Fields which are self/system generated, no need to export/import
        static  Set<String> blacklistedFields = new Set<String>{'CompletedDateTime','RecurrenceRegeneratedType','RecurrenceMonthOfYear',
            'RecurrenceInstance','RecurrenceDayOfMonth','RecurrenceDayOfWeekMask','RecurrenceType','RecurrenceTimeZoneSidKey',
            'RecurrenceEndDateOnly','RecurrenceStartDateOnly  ','RecurrenceActivityId','ReminderDateTime','ActivityOriginType',
            'ArchivedDate','IsArchived','IsClosed','PrioritySortOrder','IsHighPriority','JigsawContactId',
            'ReportsToName','EmailBouncedReason','EmailBouncedDate','IsEmailBounced','JigsawContactId',
            'Id','IsDeleted','CreatedDate','LastModifiedDate','SystemModstamp','LastActivityDate','LastViewedDate',
            'LastReferencedDate','UserRecordAccessId','MasterRecordId','AccountSource','IsCssEnabled',
            'CssLastLoginDate','CompareName','PhotoUrl','CompareSite','OwnerAlias','JigSawCompanyId',
            'ConnectionReceivedDate','ConnectionSentDate','AccountRollupId','ProductIsArchived', 'OwnerId', 'Id', 'SetupOwnerId'};

            //This is to filter out reference/lookup field before export
        Static Set<String> unUsedObject = new Set<String>{'dummy__C'};
        

    
    
    @AuraEnabled(cacheable=true)
    public static String exportConfigData(String filterString){
        filterString = String.escapeSingleQuotes(filterString);
        Map<String, String> objectsQuery = new Map<String, String>{};
        Map<String, Set<String>> objectsFields = new Map<String, Set<String>>{};

        String jsonConfigData = '';
        try{

            Map<String, Schema.SObjectType> schemaMap = Schema.getGlobalDescribe();
            
            //Collecting externalId first for all objects
            for(String obj: objects){
                Map<String, Schema.SObjectField> fieldMap = schemaMap.get(obj).getDescribe().fields.getMap();

                for(Schema.SObjectField sfield : fieldMap.Values())
                {
                    Schema.DescribeFieldResult  des = sfield.getDescribe();
                    
                    if(des.isExternalID() && ){
                        objectsExtId.put(obj, sfield);
                        
                        //Adding external Id for object which has exception like multiple ExternalIds
                        // this can be improved by having input and managed dynamically
                        if(obj=='Product__c' && des.getName()== 'External_Id__c'){
                            objectsExtIdExcep.put(obj,sfield);
                        }
                    }
                
                }
            }
        
            for(String obj: objects){
                Map<String, String> lookupFieldToRefField = new Map<String, String>();
                Map<String, String> refFieldToObject = new Map<String, String>();
                Set<String> objLookupFields = new Set<String>();
                Set<String> objLookupRefExtIdFields = new Set<String>();
                Set<String> fields = new Set<String>();
                //Map<String, Schema.SObjectType> schemaMap = Schema.getGlobalDescribe();
                Map<String, Schema.SObjectField> fieldMap = schemaMap.get(obj).getDescribe().fields.getMap();
                

                for(Schema.SObjectField sfield : fieldMap.Values())
                {
                    Schema.DescribeFieldResult  des = sfield.getDescribe();
                    if(!des.isCalculated() && des.isCreateable() )
                        //&& !des.isDefaultedOnCreate())
                    {
                        if(des.getName() == 'RecordTypeId'){
                            fields.add('RecordType.DeveloperName');
                        }
                        else{
                            fields.add(des.getName());
                        }
                    }
                    
                    
                    if( des.isCustom() &&  des.getReferenceTo() !=null && des.getRelationshipName() != null){
                        
                        if(!unUsedObject.contains(des.getReferenceTo()[0].getDescribe().getName())){
                            lookupFieldToRefField.put(des.getName(), des.getRelationshipName());
                            refFieldToObject.put(des.getName(), des.getReferenceTo()[0].getDescribe().getName());
                        }
                    }
                    
                }
                
                //replacing existing key with below info
                //once object with multiple externalId are managed dynmically, below piece of code will undergo changes
                objectsExtId.put('Product__c',objectsExtIdExcep.get('Product__c'));

                for(String lookupField :lookupFieldToRefField.keySet()){
                    
                    String refExtIdField = lookupFieldToRefField.get(lookupField)+ '.' + 
                    (objectsExtId.get(refFieldToObject.get(lookupField))).getDescribe().getName();
                    objLookupRefExtIdFields.add(refExtIdField);
                }

                fields.removeAll(blacklistedFields);
                fields.removeAll(lookupFieldToRefField.keyset());
                fields.addAll(objLookupRefExtIdFields);
                objectsFields.put(obj, fields);
            }  
                
            for(String obj: objects){
                
                String query='';
                query = 'Select '+String.join(new List<String>(objectsFields.get(obj)), ',')+ ' from '+obj +' '+ filterString
                + ' Order by CreatedDate';
                objectsQuery.put(obj, query);
            }
            
            Map<String, List<sObject>> objRecords = new Map<String, List<sObject>>();
                for(String obj : objects){
                    List<SObject> records = database.query(objectsQuery.get(obj));
                    if(records != null && records.size()>0 ){
                        objRecords.put(obj,records);
                        
                    }
                    
                }
            jsonConfigData = JSON.serializePretty(objRecords, true);
            return jsonConfigData;
        }
        catch(Exception ex){
            system.debug('::ex:'+ex.getMessage()+'::line:'+ex.getLineNumber());
            return ex.getMessage();
        }
       
    }
}