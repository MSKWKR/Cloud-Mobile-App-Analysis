var MessageIntv;
let host_ip = window.location.hostname;
let host_port = '8089';
var ws = new WebSocket(`ws://${host_ip}:8080/ws`);


function GetMessage() {
    sendAction("getOutput");
}

function setbuttonDisable(disabled) {
    document.getElementById('btn-auto').disabled = disabled;
    document.getElementById('btn-exit').disabled = disabled;
    document.getElementById('btn-manual').disabled = disabled;
    // document.getElementById('btn-load-old').disabled = disabled;
    // document.getElementById('btn-load-curr').disabled = disabled;
    // document.getElementById('btn-save-record').disabled = disabled;
    document.getElementById('btn-get-result').disabled = disabled;
    document.getElementById('btn-start').disabled = !disabled;
}

function table_reset() {
    // Change the selector if needed
    var $table = $('#table-static-result'),
    $bodyCells = $table.find('tbody tr:first').children(),
    colWidth;
    $table.find('tbody').css('height', "200px");
    // Get the tbody columns width array
    colWidth = $bodyCells.map(function() {
        return $(this).width();
    }).get();

    // Set the width of thead columns
    $table.find('thead tr').children().each(function(i, v) {
        $(v).width(colWidth[i]);
    });    
}

// hostname => MOBSF server
$(document).ready(function() {
    let ip = 'android';
    let port = '5555';
    var url = "http://" + host_ip + ":" + host_port + `/#!action=stream&udid=${ip}%3A${port}&player=mse&ws=ws%3A%2F%2F` + host_ip +`%3A` + host_port + `%2F%3Faction%3Dproxy-adb%26remote%3Dtcp%253A8886%26udid%3D${ip}%253A${port}`;
    // let ip = '192.168.55.103';
    // let ip = '192.168.50.23';
    // let port = '5555';
    // var url = `http://127.0.0.1:8000/#!action=stream&udid=${ip}%3A${port}&player=mse&ws=ws%3A%2F%2F127.0.0.1%3A8000%2F%3Faction%3Dproxy-adb%26remote%3Dtcp%253A8886%26udid%3D${ip}%253A${port}`;
    $('#frame-phone').attr("src", url);
    $("#maldroidSuccess").hide();
    $("#maldroidFailed").hide();
    $("#mobsfSuccess").hide();
    $("#mobsfFailed").hide();
    MaldroidIntv = setInterval(getMaldroidStatus,3000);
    MobSFIntv = setInterval(getMobSFStatus,3000);
});

// [halloworld]: monitor maldroid state
// https://ithelp.ithome.com.tw/questions/10199611
function getMaldroidStatus(){
    sendAction("getMaldroidStatus");
}
function getMobSFStatus(){
    sendAction("getMobSFStatus");
}
function EnableStaticResult(disabled){
    document.getElementById('btn-get-static-result').disabled = !disabled;
}
function logout(){
    console.log("Fuck")
    $.ajax({
        // url: "http://"+$(location).attr('hostname')+":8080/logout",
        url: "/logout",
        type: 'get',
        async: false,
        success: function(msg){
            window.location.href = "http://"+$(location).attr('hostname')+":8080/login";
        }
    });
}

function getCookie(name) {
    var arr = document.cookie.split('; ');
    for (var i = 0; i < arr.length; i++) {
        var arr1 = arr[i].split('=');
        if (arr1[0] == name) {
            return arr1[1];
        }
    }
    return '';
};

function home() {
    $.ajax({
        url: "/upload",
        type: 'get',
        async: false,
        setCookies: getCookie("lang"),
        success: function (msg) {
            window.location.href = "/upload";
        }
    });
}

ws.onopen = function() {
    if(Cookies.get('apk_name') != undefined) {
        var msg = {'packname' : Cookies.get('apk_name')};
        ws.send(JSON.stringify(msg));
    }
}

// webapp.py can send json to here, to change btn status etc...
function parse_status(status, data) {
    console.log(status);
    switch (status) {
        case "STOPINTERVAL":
            setbuttonDisable(true);
            $('#label-status').attr("class","badge badge-secondary");
            $('#label-status').text("Control Server STOPPED !!!!!!!!");
            if(MessageIntv) {
                clearInterval(MessageIntv);
            }
            $('#btn-sauto').prop("disabled", true);
            $('#btn-tauto').prop("disabled", true);
            break;
        case "ServerStart":
            $('#label-status').attr("class","badge badge-primary");
            $('#label-status').text("Control Server Running !!!!!!!!");
            setbuttonDisable(false);
            EnableStaticResult(false);  
            MessageIntv = setInterval(GetMessage, 1000);
            break;
        case "FAIL":
            $('#label-status').attr("class","badge badge-danger");
            $('#label-status').text("FAIL to start server No package name");
            break;
        case "UnknownAction":
            $('#label-status').attr("class","badge badge-danger");
            $('#label-status').text("Unknown action");
            break;
        case "INSTALLAPK":
            setbuttonDisable(true);
            $('#label-status').attr("class","badge badge-danger");
            $('#label-status').text("Installing APK..");
            break;
        case "SERVERSTARING":
            $('#label-status').attr("class","badge badge-danger");
            $('#label-status').text("Staring Server");
            break;
        case "SHOWMSG":
            if(data["msgdata"] != undefined) {
                alert(data["msgdata"]);
            }
            else {
                console.log("SOWMSG NO DATA!!");
            }
        case "LOADSUCCESS":
            if(data["tostate_list"] != undefined) { 
                var tostate_list = data["tostate_list"];
                $('#sel-toState').empty().append("<option selected>Select to State</option>");
                tostate_list.forEach(element => {
                    $('#sel-toState').append(new Option(element, element));
                });
                alert("Load Record Success!");
            }
        case "CANSAUTO":
            document.getElementById('btn-sauto').disabled = false;
            break;
        case "SETTING":
            if(data["seting"] != undefined) {
                var disa = data["seting"];
                settingDisable(disa);
            }
            break;
        case "STATIC":
            console.log("In case Status");
            $('#label-status').attr("class","badge badge-primary");
            $('#label-status').text("Static analyze scanning!!!!");
            break;
        case "STATIC_FIN":
            console.log("In FIN");
            $('#label-status').attr("class","badge badge-primary");
            $('#label-status').text("Static Scan Finish!!!!");
            break;
        case "CANSHOWACG":
            document.getElementById('btn-tauto').disabled = false;
            document.getElementById('btn-ascan').disabled = false;
            readJSON();
            break;
    }
}

//[YuHeng]: receive message from Server
ws.onmessage = function(event) { 
    var data = JSON.parse(event.data);
    console.log(data);
    if(data["status"] != undefined) {
        console.log("data status", data)
        parse_status(data["status"], data);
    }
    if(data["log_mesg"] != undefined) { // Show Log
        var messages = document.getElementById('textarea-logmessages');
        messages.value += data["log_mesg"];
        messages.scrollTo(0,messages.scrollHeight);
    }
    if(data["java_source"] != undefined) { // Show Java scoure code
        $("#code-javasource").text(data["java_source"]);
        hljs.highlightBlock($("#code-javasource").get(0));
    }
    if(data["avalible_text"] != undefined) { //[YuHeng]:insert fuzz selection into
        var avalible_text = data["avalible_text"];
        //console.log(avalible_text);
        $('#sel-fuzzText').empty().append("<option value=\"-1\" selected>Select Fuzz Text</option>");
        avalible_text.forEach(element => {
            $('#sel-fuzzText').append(new Option(`Text id: ${element["id"]} , name: ${element["name"]}`, element["id"]));
        });
    }
    if(data["problem"] != undefined) {
        $('#table-static-result > tbody').html("");
        var problemList =data["problem"];
        for (i = 0; i < problemList.length; i++) {
            _data = problemList[i];
            var tr = $('<tr>');
            tr.append($('<td>').text(_data["tools"]))
            tr.append($('<td>').text(_data["level"]))
            tr.append($('<td>').text(_data["title"]))
            tr.append($('<td>').text(_data["standard"]))
            tr.append($('<td>').text(_data["others"]))
            $('#table-static-result tbody').append(tr);
        }
        table_reset();
    }
    if(data["maldroid_state"] != undefined){
        if (data["maldroid_state"] === "success"){
            if(MaldroidIntv){
                clearInterval(MaldroidIntv);
            }
            $("#maldroidSuccess").prop('checked', true);
            $("#maldroid_state").text(data["maldroid_state"]);
            EnableStaticResult(true);
            sendAction('STATIC_FIN');
        }
        else if(data["maldroid_state"] === "failed"){
            if(MaldroidIntv){
                clearInterval(MaldroidIntv);
            }
            $("#maldroidFailed").prop('checked', true);
            $("#maldroid_state").text(data["maldroid_state"]);
        }
    }
    if(data["mobSF_state"] != undefined){
        if (data["mobSF_state"] === "success"){
            if(MobSFIntv){
                clearInterval(MobSFIntv);
            }
            $("#mobsfSuccess").prop('checked', true);
            $("#mobsf_state").text(data["mobSF_state"]);
        }
        else if(data["mobSF_state"] === "failed"){
            if(MobSFIntv){
                clearInterval(MobSFIntv);
            }
            $("#mobsfFailed").prop('checked', true);
            $("#mobsf_state").text(data["mobSF_state"]);
        }
    }
};
ws.onclose = function() {
    if(MessageIntv) {
        clearInterval(MessageIntv);
    }
}
function sendAction(action) {
    //var input = document.getElementById("messageText")
    var msg = {"action" : action};
    ws.send(JSON.stringify(msg));
}
function re_upload() {
    if(Cookies.get('apk_name') != undefined) {
        Cookies.remove('apk_name');
    }
    window.open("upload","_self");
}

function goToState() {
    if($("#sel-toState").val() != "-1"){
        var msg = {"action" : "goto", "toState": $("#sel-toState").val()};
        ws.send(JSON.stringify(msg));
    }
}

//[YuHeng]:execute Fuzz, select text from "#sel-fuzzText"
function startFuzz() {
    var value = parseInt($("#sel-fuzzText").val(), 10);
    if( value > 0 && value != NaN) {
        var msg = {"action" : "fuzz", "FuzzID": $("#sel-fuzzText").val()};
        ws.send(JSON.stringify(msg));
    }
}

function setAccPass() {
    var msg = {"action" : "setpa", "setacc": $("#txt-setUsername").val(), "setpass": $("#txt-setPassword").val(), "settext": $("#txt-setText").val()};
    ws.send(JSON.stringify(msg));
}

//[YuHeng]: jump to selected activity
function startJump(actName){
    var msg = {"action" : "jump", "jumpActName": actName};
    console.log("msg: "+ msg["jumpActName"]);
    ws.send(JSON.stringify(msg));
}

function showResult() {
    sendAction('exit');
    window.location.href = "/result";
}
function showStaticResult(){
    sendAction('exit');
    window.location.href = "/static-result";
}
function showHistoryResult(){
    sendAction('exit');
    window.location.href = "/history-result";
}

function settingDisable(disable) {
    document.getElementById('btn-realod').disabled = disable;
    document.getElementById('btn-load-old').disabled = disable;
    document.getElementById('btn-load-curr').disabled = disable;
    document.getElementById('btn-save-record').disabled = disable;
    document.getElementById('btn-get-result').disabled = disable;
    document.getElementById('btn-set-acpw').disabled = disable;

    document.getElementById('btn-auto').disabled = disable;
    document.getElementById('btn-sauto').disabled = disable;
    document.getElementById('btn-toState').disabled = disable;
    document.getElementById('btn-fuzz').disabled = disable;
    document.getElementById('btn-start').disabled = disable;
}
