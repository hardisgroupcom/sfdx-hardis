public class ConfigBuilderImport {
	
    static Map<String, Schema.SObjectField> objectsExtId = new Map<String, Schema.SObjectField>();
    
    //This might be needed if code is improved, it can be decided by uploaded file itself
    static List<String> objects = new List<String>{
        'SBQQ__QuoteTemplate__c','SBQQ__TemplateContent__c'
    };
    Static Set<String> unUsedObject = new Set<String>{'Product__c','BusinessHours'};
        
    public ConfigBuilderImport(){
             
    }
    
    //Accept text file having JSON content 
    @AuraEnabled(cacheable=false)
    public static String importConfigData(String base64){
       // system.debug(':::'+base64);
        Blob textBlob = EncodingUtil.base64Decode(base64);
        String configData = textBlob.toString();
        Map<String, Set<String>> objToLookupFields = new Map<String, Set<String>>();
        Map<String, String> refFieldToObject = new Map<String, String>();
        Map<String, Object> recordsByObj =    (Map<String, Object>) JSON.deserializeUntyped(configData);

        Map<String, String> objSelfLookUpFields = new Map<String, String>();
        for(String obj: objects){
            Set<String> fields = new Set<String>();
            Map<String, Schema.SObjectType> schemaMap = Schema.getGlobalDescribe();
            Map<String, Schema.SObjectField> fieldMap = schemaMap.get(obj).getDescribe().fields.getMap();
            
            Set<String> objLookupFields = new Set<String>();
            Set<String> objLookupRefExtIdFields = new Set<String>();

            Set<String> lookupFields = new Set<String>();
            for(Schema.SObjectField sfield : fieldMap.Values())
            {
                
                
                Schema.DescribeFieldResult  des = sfield.getDescribe();
            
                if(des.isExternalID()){
                    objectsExtId.put(obj, sfield);
                   
                }
                
                if( des.isCustom() &&  des.getReferenceTo() !=null && des.getRelationshipName() != null){
                        
                    if(!unUsedObject.contains(des.getReferenceTo()[0].getDescribe().getName())){
                        
                        //lookupFieldToRefField.put(des.getName(), des.getRelationshipName());
                        lookupFields.add(des.getName());
                        system.debug('::lookupFields::'+lookupFields);
                        if(des.getReferenceTo()[0].getDescribe().getName() == obj){
                           objSelfLookUpFields.put(obj, des.getName());
                        }
                        //Removing lookup fields which has relationship to own object
                        lookupFields.removeAll(objSelfLookUpFields.values());
                    }

                }
                
            }
            objToLookupFields.put(obj,lookupFields);
             //Adding external Id which has exception like multiple ExternalIds
             //Can be improvised by accpeting such objects name as input and dynamically handling below code instead
           // objectsExtId.put('Product__c',
           // Schema.getGlobalDescribe().get('Product__c').getDescribe().fields.getMap().get('External_Id__c'));
        }

        Map<String, List<SObject>> objToRecords = new Map<String, List<SObject>>();
        Map<String, List<SObject>> objToRecordsFirst = new Map<String, List<SObject>>();

        for(String obj :objects){
            if(recordsByObj.containsKey(obj)){

                List<SObject> sobjRecords = new List<SObject>();
                List<SObject> sobjRecordFirstInsert = new List<SObject>();
                List<SObject> sobjRecordLaterInsert = new List<SObject>();
                
                List<Object> recordsJson = (List<Object>)recordsByObj.get(obj);
                for(Object jsonRec : recordsJson){
                    jsonRec = removeAttributes((Map<String,Object>)jsonRec, objToLookupFields.get(obj));
                    String objSer = JSON.serializePretty(jsonRec);
                    SObject sObj = (SObject)JSON.deserialize(objSer, SObject.class);
                    sobjRecords.add(sObj);
                }
                //Order the records in case of self reference lookup
                if(objSelfLookUpFields.containsKey(obj))
                {
                    for(SObject sobj: sobjRecords){
                        if(sobj.get(objSelfLookUpFields.get(obj)) == null){
                           sobjRecordFirstInsert.add(sobj);
                        }  
                    }
                    for(SObject sobj: sobjRecords){
                        if(sobj.get(objSelfLookUpFields.get(obj)) != null){
                            sobj.put(objSelfLookUpFields.get(obj), null);
                            //Removing the lookup field from sobj.
                            String jsonStr = JSON.serialize(sobj);
                            Map<String,Object> objJson = (Map<String,Object>)JSON.deserializeUntyped(jsonStr);
                            objJson.remove(objSelfLookUpFields.get(obj));
                            String objSer = JSON.serializePretty(objJson);
                            sobj = (SObject)JSON.deserialize(objSer, SObject.class);
                            sobjRecordLaterInsert.add(sobj);
                        }
                        
                    }
                }
                else{
                    sobjRecordLaterInsert.addAll(sobjRecords);
                }
                //creating 2 collection to upsert separtiely due to dependecy on records
                objToRecordsFirst.put(obj,sobjRecordFirstInsert );
                objToRecords.put(obj,sobjRecordLaterInsert );
                
                
            }
        }

        for(String objName : objects){
            if(objToRecords.containsKey(objName)){
                
                //inserting records first which has self lookup empty and are dependent for rest of records 
                if(objToRecordsFirst.containsKey(objName)){
                    Database.upsert(objToRecordsFirst.get(objName), objectsExtId.get(objName));
                }
                Database.upsert(objToRecords.get(objName), objectsExtId.get(objName));
            }
        }
        
        return 'Config Imported Successfully';
    }

    //Removes the Key/fields which are not needed for next org
    public static Object removeAttributes(Object jsonObj, Set<String> extraKeyToRemove){
        Map<String,Object>  jsonObjMap = (Map<String,Object>)jsonObj;
        for(String key : jsonObjMap.keySet()) {
            if(key == 'Id' || key == 'RecordTypeId' || key=='RecordType' || extraKeyToRemove.contains(key)) {
                jsonObjMap.remove(key);
            } else {
                if(jsonObjMap.get(key) instanceof Map<String,Object>) {
                    removeAttributes((Map<String,Object>)jsonObjMap.get(key), extraKeyToRemove);
                }
            }
        }
        return jsonObjMap;
    }
    
    
    
    
    
}