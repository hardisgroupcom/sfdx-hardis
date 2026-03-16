import { LightningElement,track,api,wire } from 'lwc';
import { ShowToastEvent } from 'lightning/platformShowToastEvent';
import importConfigData from '@salesforce/apex/ConfigBuilderImport.importConfigData'

export default class Fileupload extends LightningElement {
    RadioValue = 'Import File';
 
    get options() {
        return [
            { label: 'Import File', value: 'Import File' },
            { label: 'Export File', value: 'Export File' },
        ];
    }
    @track importFileFieldValue = true;
    @track exportFileFieldValue = false;
   
   /* @api recordId;*/
     fileData;
    openfileUpload(event) {
        const file = event.target.files[0];
        var reader = new FileReader();
        reader.onload = () => {
           var base64 = reader.result.split(',')[1]
            this.fileData = {
                'filename': file.name,
                'base64': base64,
            }
            console.log(base64)
        }
        reader.readAsDataURL(file)
       
    }

    radioOptionOnChnage(){
        if (RadioValue == 'Import File'){
            this.importFileFieldValue = true;
            this.exportFileFieldValue = false;
        }else{
            this.importFileFieldValue = false;
            this.exportFileFieldValue = true;
        }
    }
    
    handleClick(){
      //const {base64, filename, recordId} = this.fileData
      
        importConfigData({ base64:this.fileData.base64 }).then(result=>{
           this.fileData = null
            //let title = 'uploaded successfully!!'
            this.toast(result)
        })
    }

    toast(title){
        const toastEvent = new ShowToastEvent({
            title, 
            variant:"success"
        })
        this.dispatchEvent(toastEvent)
    }
}