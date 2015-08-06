var async = require('async');
var CloudAPI = require('node-flower-power-cloud');
var Noble = require ('noble');
var FlowerPower = require('node-flower-power');
var fs = require('fs');
var lazy = require("lazy");
var asyncFunction = require("sync");
var uuid = require('node-uuid');

var sessionPeriod = "";
var sUpTime = "";
var sessionStartIndex = "";
var currentID = "";
var historic = "";
var uuid = "";
var user_config_version1 = "";

var clientID     = '';
var clientSecret = '';
var userName     = '';
var passPhrase   = '';

var api = '';

var loop1 = 0;
var loop2 = 0;
var loop3 = 0;

var order = 0;

var startIdx = 0;
var NbrEntries = 0;
var lastEntry = 0;

var firstPartUuid = 7;
var lastPartUuid = 11;
var defaultIndexRecovery = 200;
var maxIndexRecovery = 3840;
var waitTimeoutMs = 10000;

var tab = [];
var tabSensors = [];
var tabIndex = [];
var uuidTab = [];
var param = [];

async.series([

  function(callback) {
    var p = 0;
    new lazy(fs.createReadStream('./params.txt'))
    .lines
    .forEach(function(line){
      param.push(line.toString());
      p = p + 1;
      if (p == 4) {
        callback();
      }
    }
  );

},

function(callback) {
  clientID     = param[0];
  clientSecret = param[1];
  userName     = param[2];
  passPhrase   = param[3];
  console.log(Date() + ' Starting new sync for clientID: ' + clientID);
/*  console.log(clientSecret);
  console.log(userName);
  console.log(passPhrase); */

  api = new CloudAPI.CloudAPI({ clientID: clientID, clientSecret: clientSecret });

  callback();
},

function(callback) {
  api.login(userName, passPhrase, function(err) {
    if (!!err) return console.log('login error: ' + err.message);

    api.getGarden(function(err, sensors, tabSensorSerial, tabHistoryIndex, user_config_version) {
      if (!!err) return console.log('getGarden: ' + err.message);

      user_config_version1 = user_config_version;
      tabSensors = tabSensorSerial;
      tabIndex = tabHistoryIndex;
      console.log('user_config_version1=' + user_config_version1 + ' tabSensors=' + tabSensors + ' tabIndex=' + tabIndex);
      callback();
    });
  }).on('error', function(err) {
    console.log('background error: ' + err.message);
  });
},

function(callback) {
  function discoUuid(){
    if (loop1 === tabSensors.length) {
      callback();
    }

    else {
      loop3 = 0;
      var uuid1 = tabSensors[loop1].toLowerCase();
      var res = uuid1.split("");

      for(t = 0; t < firstPartUuid; t++){
        uuid += res[t];
      }
      for(t = lastPartUuid; t < res.length; t++){
        uuid += res[t];
      }
      uuidTab.push(uuid);
      loop1 ++;
      uuid = "";
      discoUuid();
    }
  };
  discoUuid();
},

function(callback) {
  var timeout;
  loop1 = 0;
  FlowerPower.discoverAll(function onDiscover(flowerPower) {
    clearTimeout(timeout);
    console.log(flowerPower.uuid)
    asyncFunction(timeout = setTimeout(function() {
      FlowerPower.stopDiscoverAll(onDiscover);
      console.log("End of discovery")
      callback();
    },waitTimeoutMs));

    for(i = 0; i < uuidTab.length; i++){
      if(uuidTab[i] === flowerPower.uuid) {
        tab.splice(i,0,flowerPower);
        console.log("SPLICE i=" + i + ' fp=' + flowerPower.uuid)
      }
    }
    loop1 ++;
  });
},

function(callback) {
  function analyser(i) {
    if(i < tab.length) {
      if(tab[i] == 1) {
        loop2 ++;
        analyser(loop2);
      }
      else{
        async.series([
          function(callback) {
            tab[i].on('disconnect', function() {
              console.log('disconnected!');
              callback();
            });
            console.log('connectAndSetup' + tab[i]);
            tab[i].connectAndSetup(callback);
            for(x = 0; x < tabIndex.length; x++){
              if(uuidTab[x] === tab[i].uuid) {
              order = x;
              console.log("order id x=" + order)
              }
            }
          },

/*          function(callback) {
            console.log('readFriendlyName');
            tab[i].readFriendlyName(function(friendlyName) {
              tab[i].writeFriendlyName(friendlyName, callback);
            });
          },

          function(callback) {
            tab[i].getHistoryNbEntries(function(data) {
              NbrEntries = data;
            console.log('getHistoryNbEntries: ' + NbrEntries);
              callback();
            });
          },
*/
          function(callback) {
            tab[i].getHistoryLastEntryIdx(function(data) {
              lastEntry = data;
              console.log('getHistoryLastEntryIdx:' + lastEntry);
              startIdx = tabIndex[order];
              callback();
            });
          },

          function(callback) {
            tab[i].getHistoryCurrentSessionID(function(data) {
              currentID = data;
              console.log('getHistoryCurrentSessionID: ' + currentID);
              callback();
            });
          },

          function(callback) {
            tab[i].getHistoryCurrentSessionStartIdx(function(data) {
              sessionStartIndex = data;
              console.log('getHistoryCurrentSessionStartIdx: ' + sessionStartIndex);
              callback();
            });
          },

          function(callback) {
            tab[i].getHistoryCurrentSessionPeriod(function(data) {
              sessionPeriod = data;
              console.log('getHistoryCurrentSessionPeriod: ' + sessionPeriod);
              callback();
            });
          },

          function(callback) {
            tab[i].getStartupTime(function(startupTime) {
              sUpTime = startupTime;
              console.log('getStartUpTime: ' + sUpTime);
              callback();
            });
          },

          function(callback) {
            console.log('getHistory original startIdx=' + startIdx);
            if (startIdx == null || (lastEntry - startIdx) > maxIndexRecovery || (startIdx - lastEntry) > 0) {
              startIdx = lastEntry - defaultIndexRecovery;
              console.log('modified startIdx=' + startIdx);
            }
            else {
              startIdx = startIdx;
            }
            if ((startIdx - lastEntry) == 0) {
              console.log("All samples already uploaded");
              historic = '';
/*              console.log('disconnect');
              tab[i].disconnect(callback);
              loop2 ++;
              analyser(loop2);
*/            }
            else {
              tab[i].getHistory(startIdx, function(error, history) {
                historic = history;
                callback();
              });
            }
          },

/*          function (callback) {
            fs.writeFile(tab[i].uuid+'.txt', historic, function (err) {
              if (err) throw err;
              callback();
            });
          },
*/
          function (callback) {
            api.uploadGarden(tabSensors[order], user_config_version1, sUpTime, historic, currentID, sessionPeriod, sessionStartIndex, function(err) {
              console.log('uploaded to sensor '+ tabSensors[order]);
              console.log('disconnect');
              tab[i].disconnect(callback);
              loop2 ++;
              analyser(loop2);
            });
          },
        ]);
      }
    }
    else {
      process.exit(0);
    }
  }
  analyser(loop2);
}
]);
