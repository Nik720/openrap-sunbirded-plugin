const fs = require('fs-extra');

function copyToApp() {
    fs.copy('./dist/', './../../sunbird-desktop-app/src/node_modules/openrap-sunbirded-plugin', err =>{
        if(err) return console.error(err);
        console.log('success!');
      });
}

copyToApp();


