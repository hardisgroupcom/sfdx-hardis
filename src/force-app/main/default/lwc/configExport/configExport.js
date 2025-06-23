import { LightningElement,  api, track  } from 'lwc';
//import { getRecord} from 'lightning/uiRecordApi';
import exportConfigData from '@salesforce/apex/ConfigBuilderExport.exportConfigData';

export default class TextFileLauncher extends LightningElement {

    @api recordId;
    @api isLoaded = false;
    text = '';
    @track filterCritera = '';

    connectedCallback() {
        //this.classList.add('new-class');
    }

    handleFilterChange(event){

        this.filterCritera = event.target.value;
        
    }

    handleClick() {
        console.log(':::,',this.filterCritera);
        this.isLoaded = !this.isLoaded;
        exportConfigData({ filterString: this.filterCritera })
            .then(result => {
            let config = result;
            this.text = `data:text/plain,${encodeURIComponent(`${config}`)}`;
            
            const downloadContainer = this.template.querySelector('.slds-m-left_x-small .downloadArea');
            const downloadUrl = this.text;
            const fileName = 'Config file.txt';

            let a = document.createElement('a');
            a.href = downloadUrl;
            a.target = '_parent';
            // Use a.download if available, it prevents plugins from opening.
            a.download = fileName;
            // Add a to the doc for click to work.
            if (downloadContainer) {
            downloadContainer.appendChild(a);
            }
            if (a.click) {
            a.click(); // The click method is supported by most browsers.
            this.isLoaded = !this.isLoaded;
            }
            // Delete the temporary link.
            downloadContainer.removeChild(a);
            
            })
            .catch(error => {
                this.error = error;
            });
            
    }

    
}