export interface KeyValueProviderInterface {
  name: string ;
  description: string;
  userSetup(): Promise<boolean>;
  userAuthenticate(): Promise<boolean> ;
  initialize(options?: any): Promise<boolean> ;
  getValue(key:string|null): Promise<any>;
  setValue(key:string|null,value: any): Promise<boolean>;
}
