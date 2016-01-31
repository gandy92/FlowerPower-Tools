var async = require('async');
var CloudAPI = require('node-flower-power-cloud');
var Noble = require ('noble');
var FlowerPower = require('node-flower-power');
var fs = require('fs');
var lazy = require("lazy");
var asyncFunction = require("sync");
var uuid = require('node-uuid');

var clientID     = '';
var clientSecret = '';
var userName     = '';
var passPhrase   = '';

var api = '';

var debug= 0;
var dry_run= 0; // set dry_run to 1 to avoid uploading data to cloud

var defaultIndexRecovery = 200;
var maxIndexRecovery = 3840;
var waitTimeoutMs = 10000;

var uuidTab = [];
var param = [];
var devices = [];

var http = require("http");

// instead of async.series(), use async.waterfall() and callback(err) to skip to final callback(err,result)
//
async.waterfall([

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
  station      = param[4];
  console.log(Date() + ' Starting new sync for clientID: ' + clientID);
/*  console.log(clientSecret);
  console.log(userName);
  console.log(passPhrase); */

  api = new CloudAPI.CloudAPI({ clientID: clientID, clientSecret: clientSecret });

  callback();
},

// ---------------------------------------------------------------------------------
// login to cloud api and retrieve list of sensors
//
function(callback) {
  api.login(userName, passPhrase, function(err) {
    if (!!err) return console.log('login error: ' + err.message);

    api.getGarden(function(err, sensors, tabSensorSerial, tabHistoryIndex, user_config_version) {
      if (!!err) return console.log('getGarden: ' + err.message);

      if (4<=debug) console.log("sensors= ",sensors);

      user_config_version1 = user_config_version;

      if (2<=debug) console.log('user_config_version1=' + user_config_version1 + ' tabSensors=' + tabSensorSerial + ' tabIndex=' + tabHistoryIndex);

      for (i= 0; i< tabSensorSerial.length; i++)
      {
        var uuid= tabSensorSerial[i].toLowerCase();
        // from serial (e.g. 9003B7 0000 C7476B), use first 6 and last six characters for uuid:
        uuid= uuid.substr(0,6)+uuid.substr(10,6);

        devices[uuid] = { uuid: uuid, api: {sensorSerial: tabSensorSerial[i], historyIndex: tabHistoryIndex[i], name: sensors[tabSensorSerial[i]].nickname}, state: 'unconfirmed' };
        if (3<=debug) console.log("cloud device: ",devices[uuid]);
      }
      callback();
    });
  }).on('error', function(err) {
    console.log('background error: ' + err.message);
    callback("error during cloud api access: "+err.message);
  });
},

// ---------------------------------------------------------------------------------
// scan for available Flower Power sensors and update device list
//
function(callback) {
  var timeout;
  loop1 = 0;
  console.log("Start of Discovery..");
  FlowerPower.discoverAll(function onDiscover(flowerPower) {
    clearTimeout(timeout);
    var uuid= flowerPower.uuid;
    if (devices[flowerPower.uuid]) {
      console.log("found registered sensor \""+uuid+"\", \""+devices[uuid].api.name+"\"");
      devices[uuid].sensor= flowerPower;
      devices[uuid].state= 'confirmed';
      uuidTab.push(uuid);
    }
    else {
      console.log("found unknown sensor \""+flowerPower.uuid+"\" - please consider registering with cloud api");
    }
    
    asyncFunction(timeout = setTimeout(function() {
      FlowerPower.stopDiscoverAll(onDiscover);
      console.log("End of discovery")
      callback();
    },waitTimeoutMs));
  });
},

// ---------------------------------------------------------------------------------
// try to connect and readout each sensor and push data to cloud
//
function(callback) {
  async.eachSeries(uuidTab, function iterator(uuid, callback) {
    connectAndReadout(uuid,callback);
  }, function done() {
    
    callback();
  });
}

//////////////////////////////////////////////////////////////////////////////////// 
], function (error,result) {
  if (error) { 
    console.log("Error in main waterfall: ",error);
  } else {
    console.log("Main waterfall dried out. Goodbye.");
  }
  process.exit(0);
}); //async.waterfall




/* *************************************************************************************************
 *
 * connect and readout one sensor and upload data to cloud 
 *
 * uuid:      index key to sensors[]
 * callback:  called at end of execution
 *
 * ************************************************************************************************/

function connectAndReadout(uuid, callback)
{
  if (devices[uuid].state != 'confirmed') {
    console.log("** Internal error: Expected device uuid="+uuid+" to be confirmed, was \""+devices[uuid].state+"\" instead.");
    callback();
    return;
  } 

  var uuid=uuid;
  var sensor= devices[uuid].sensor;
  var lastEntry= 0;
  var startIdx= 0;
  var currentID= '';
  var sessionStartIndex= '';
  var sessionPeriod = "";
  var sUpTime = "";
  var historic = null;
  var NbrEntries = 0;



  console.log("");
  console.log("Now reading out uuid="+uuid+", name=\""+sensor.name+"\": ");

  devices[uuid].state= 'connect';

  async.waterfall([
    //--------------------------------------------------------------
    function(callback) { // -------- waterfall task: connectAndSetup
            
            sensor.on('disconnect', function() {
              if (1<=debug) console.log('peripheral disconnected!');
              callback('disconnect'); // check in final callback, if this is an error
            });
            if (1<=debug) console.log('connectAndSetup ' + uuid);

            sensor.connectAndSetup(callback);
    },

    //---------------------------------------------------------------------
    function(callback) {
      devices[uuid].state= 'connected';
      try {
            // console.log('readBatteryLevel');
            sensor.readBatteryLevel(function(batteryLevel) {
              console.log('readBatteryLevel:' + batteryLevel);
              devices[uuid].batteryLevel = batteryLevel;
              callback();
            });
      } catch(error) { callback("readBatteryLevel: "+error.message); }
    },

    //---------------------------------------------------------------------
    function(callback) { // -------- waterfall task: getHistoryLastEntryIdx
      devices[uuid].state= 'connected';
      try {
            sensor.getHistoryLastEntryIdx(function(data) {
              lastEntry = data;
              console.log('getHistoryLastEntryIdx:' + lastEntry);
              startIdx = devices[uuid].api.historyIndex;
              callback();
            });
      } catch(error) { callback("getHistoryLastEntryIdx: "+error.message); }
    },

    //-------------------------------------------------------------------------
    function(callback) { // -------- waterfall task: getHistoryCurrentSessionID
      try {
            sensor.getHistoryCurrentSessionID(function(data) {
              currentID = data;
              console.log('getHistoryCurrentSessionID: ' + currentID);
              callback();
            });
      } catch(error) { callback("getHistoryCurrentSessionID: "+error.message); }
    },

    //-------------------------------------------------------------------------------
    function(callback) { // -------- waterfall task: getHistoryCurrentSessionStartIdx
      try {
            sensor.getHistoryCurrentSessionStartIdx(function(data) {
              sessionStartIndex = data;
              console.log('getHistoryCurrentSessionStartIdx: ' + sessionStartIndex);
              callback();
            });
      } catch(error) { callback("getHistoryCurrentSessionStartIdx: "+error.message); }
    },

    //-----------------------------------------------------------------------------
    function(callback) { // -------- waterfall task: getHistoryCurrentSessionPeriod
      try {
            sensor.getHistoryCurrentSessionPeriod(function(data) {
              sessionPeriod = data;
              console.log('getHistoryCurrentSessionPeriod: ' + sessionPeriod);
              callback();
            });
      } catch(error) { callback("getHistoryCurrentSessionPeriod: "+error.message); }
    },

    //--------------------------------------------------------------
    function(callback) { // -------- waterfall task: getStartupTime
      try {
            sensor.getStartupTime(function(startupTime) {
              sUpTime = startupTime;
              console.log('getStartUpTime: ' + sUpTime);
              callback();
            });
      } catch(error) { callback("getStartupTime: "+error.message); }
    },

    //--------------------------------------------------------------
    function(callback) { // -------- waterfall task: getHistory
      try {
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
              historic = null;
              callback();
              //callback("no data to upload");
            }
            else {
              sensor.getHistory(startIdx, function(error, history) {
                devices[uuid].state= 'download';
                // uncomment for debugging, this REALLY produces a lot of noise..
                //console.log("getHistory uuid="+uuid+": received ",history);
                
                // apparently, getHistory() may issue multiple calls to callback() 
                // - so, we accept only the first:
                if (historic==null) {
                  if (1<=debug) console.log("got all data from "+uuid);
                  devices[uuid].state= 'disconnect'; // disconnects are OK from now on
                  historic = history;
                  callback();
                }
              });
            }
      } catch(error) { callback("getHistory: "+error.message); }
    },

    //--------------------------------------------------------------
    function(callback) { // -------- waterfall task: callbackScavange
      //
      // This is really only a workaround to avoid multiple executions
      // of uploadGarden. 
      // Apparently, getHistory() may call callback() multiple times.
      // We already try to handle this by testing historic, but still...
      //
      if (devices[uuid].state== 'downloaded') { 
        console.log("** ERROR: callbackScavange triggered for "+uuid);
        return;
      }
      devices[uuid].state= 'downloaded';
      callback();
    },

    //--------------------------------------------------------------
    function(callback) { // -------- waterfall task: uploadGarden
      try {
          var sensorSerial= devices[uuid].api.sensorSerial;
          if (!dry_run) {
            if (historic) {
              console.log('now uploading to sensor '+sensorSerial);
              api.uploadGarden(sensorSerial, user_config_version1, sUpTime, historic, currentID, sessionPeriod, sessionStartIndex, function(err) {
                console.log('uploaded to sensor '+ sensorSerial);
                callback();
              });
            } else {
              console.log('skipping upload to sensor '+sensorSerial);
              callback(); //nothing to upload, proceed to disconnect
            }
          } 
          else {
            console.log("dry-run, no upload for "+sensorSerial+" w/ user_config_version="+user_config_version1+".");
            callback();
          }
      } catch(error) { callback(": "+error.message); }
    },

    //--------------------------------------------------------------
    function(callback) { // -------- waterfall task: report to FHEM
      console.log("informing FHEM about "+uuid);
      try {
            var cmd="setreading " + station + "FlowerPower last";
            cmd= cmd + " uuid:" + uuid;
            cmd= cmd + " batteryLevel:" + devices[uuid].batteryLevel;
            cmd= cmd + " historyStartIdx:" + startIdx;
            cmd= cmd + " historyLastEntry:" + lastEntry;
            cmd= cmd + " sessionID:" + currentID;
            cmd= cmd + " sessionStartIdx:" + sessionStartIndex;
            console.log("cmd is "+cmd);
            http.get({
                host:'hal.fritz.box', 
                port:8088, 
                path: '/fhem?cmd='+encodeURIComponent(cmd)+'&XHR=1'
            }, (res) => {
                console.log(`Got response: ${res.statusCode}`);
                // consume response body
                res.resume();
            }).on('error', (e) => {
                console.log('Got error on http.get(): ${e.message}');
            });
            callback();
      } catch(error) { callback(": "+error.message); return; }
    },

    //--------------------------------------------------------------
    function(callback) { // -------- waterfall task: disconnect
      if (1<=debug) console.log("final steps for "+uuid);
      devices[uuid].state= 'disconnect';
      try {
            console.log("disconnect from "+uuid);
            sensor.disconnect(callback);
      } catch(error) { callback(": "+error.message); return; }
    }

  ],
  ////////////////////////////////////////////////////////////////// 
  function(error, result) {
    if (error) {
      if ((error=='disconnect') && (devices[uuid].state == 'disconnect')) {
        if (2<=debug) console.log("(catching expected disconnect of "+uuid+")");
        return; // no further callbacks!
      }
      console.log("** Early end of waterfall (uuid="+uuid+"): ",error);
      try {
            var cmd="setreading " + station + "FlowerPower last";
            cmd= cmd + " uuid:" + uuid;
            cmd= cmd + " lastError:" + error;
            console.log("cmd is "+cmd);
            http.get({
                host:'hal.fritz.box',
                port:8088,
                path: '/fhem?cmd='+encodeURIComponent(cmd)+'&XHR=1'
            }, (res) => {
                console.log(`Got response: ${res.statusCode}`);
                // consume response body
                res.resume();
            }).on('error', (e) => {
                console.log('Got error on http.get(): ${e.message}');
            });
      } catch(error) { callback(": "+error.message); return; }
    } else {
      console.log("Finishing waterfall (uuid="+uuid+") as planned.");
    } 
    callback();
  });
}
