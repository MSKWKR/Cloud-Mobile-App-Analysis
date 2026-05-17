#!/usr/bin/python3
# -*- coding: UTF-8 -*-

import socket, sys
import struct,os,re
import threading,select
import time
import enum
import signal
import multiprocessing
from androguard.misc import AnalyzeAPK
import frida
from argparse import ArgumentParser
from asgiref.sync import async_to_sync
from Records import *
from Global_setting import SETTING
import asyncio
import traceback
import json
from Navigation_Handler import Navigation_Handler
from Fuzzing_Handler import Fuzzing_Handler
from datetime import datetime
import subprocess
import copy

#CMDDEBUG = True
CMDDEBUG = False

"""
APPList: 
# com.yuanta.globalplus
# jakhar.aseem.diva
# mong.moptt
# com.reactdiva
# com.mega
# com.example.mynewdiva
# com.joshua.jptt
# tw.com.tsca.mbank146
# jakhar.aseem.diva
"""
# APPNAME = "com.ktb.pbank.app"
# APPNAME = "com.linepaycorp.talaria"
# APPNAME = "com.example.mynewdiva"
# APPNAME = "com.ktb.pbank.app"
# APPNAME = "com.mega"
# APPNAME= "jakhar.aseem.diva"
# APPNAME = "com.q.t"
# APPNAME = "com.example.declaration"
# APPNAME = "com.ttb" #台中商銀證券
# APPNAME = "com.example.simpletest"
APPNAME = "com.example.mynewdivabeta"
# APPNAME = "com.example.mynewdiva"

class StateButtonEvent:
    def __init__(self,_Name):
        self.m_iIndex = 0
        self.m_iTotalNumber = -1
        self.m_ParentState = None        
        self.m_strName = _Name
        self.m_ListView = []
        self.m_bHaveTraced = False
        self.m_DefaultNextState = None
        self.m_bIsActivity = False
        self.m_Signature = ""
        #self.SetListID(_ListButtonID)
    def SetListView(self,_ListView):
        totalLen = len(_ListView)
        for i in range(totalLen):
            viewedIndex = self.FindIndexByID(_ListView[i].m_iID)
            if(viewedIndex == None):
                self.m_ListView.append(_ListView[i])
            else: # if this View already exists, we will move the Event to ours' view
                self.m_ListView[viewedIndex].Add_Extend_ClickEvent(_ListOfClickEvent = _ListView[i].m_ListClickEvent)
        self.m_iTotalNumber = len(self.m_ListView)
        self.UpdateSignature()
    def UpdateSignature(self):
        Signature = ""
        for TraceView in self.m_ListView:
            Signature += "{},{} ".format(TraceView.m_iID,TraceView.m_iTotalNumber)
        self.m_Signature = Signature
    def GetItem(self,_iIndex):
        return self.m_ListButton[_iIndex]
    def initAllIndex(self):
        for tmpview in self.m_ListView:
            tmpview.m_iIndex = 0
        self.m_iIndex = 0
    def GetIndex(self):
        ReturnValue = -1

        iViewIndex = self.m_iIndex
        iItemIndex = -1
        iEventValue = -1
        print(f"[GetIndex] State: {self.m_strName} Index : {iViewIndex}, Total : {self.m_iTotalNumber}")
        if(iViewIndex >= self.m_iTotalNumber):
            iViewIndex = -1
        else:
            iEventValue,iItemIndex = self.m_ListView[iViewIndex].GetIndex()
        return iEventValue,iViewIndex,iItemIndex

    def HaveFinishAllEvent(self):
        ReturnValue = False
        iEventValue,iViewIndex,iItemIndex = self.GetIndex()
        if(iEventValue == -1):
            ReturnValue = True
        return ReturnValue
    def FinishEvent(self):
        if(self.m_iIndex < self.m_iTotalNumber):
            self.m_ListView[self.m_iIndex].FinishEvent()
            iEventValue,iItemIndex = self.m_ListView[self.m_iIndex].GetIndex()
            #print('Next Index : ' + str(iEventValue))
            if(iEventValue == -1):
                #print('Finish Index : ' + str(self.m_iIndex))
                self.m_iIndex += 1

    def Clear(self):
        self.m_ListRemainButtonIndex = []
    def GetCurrentView(self):
        ReturnValue = None
        if(self.m_iIndex < self.m_iTotalNumber):
            ReturnValue = self.m_ListView[self.m_iIndex]
        return ReturnValue
    def RemoveIndex(self,_iIndex):
        if(_iIndex in self.m_ListRemainButtonIndex):
            ##print('Remove : ' + str(_iIndex))
            self.m_ListRemainButtonIndex.remove(_iIndex)
    def GetCurrentEvent(self):
        ReturnValue = None
        print('Event Index : {}, TotalNumber : {}'.format(self.m_iIndex,self.m_iTotalNumber))
        #print("GetCurrentEvent!")

        if(self.m_iIndex < self.m_iTotalNumber):
            ReturnValue = self.m_ListView[self.m_iIndex].GetCurrentEvent()
        return ReturnValue
    def ForceFinish(self):
        self.m_iIndex += 1
    def FinishAll(self):
        self.m_bHaveTraced = True
    def list_all_Record(self, state_name):
        state_dic = {}
        view_data = []
        for i in self.m_ListView:
            view_dic = {}
            ViewID = i.m_iID
            #print(f"Button ID: {ViewID}")
            event_data = []
            for j in i.m_ListClickEvent:
                event_dic = {}
                ClickType = j.m_iType
                #print(f"Click type: {ClickType} Next State: {j.m_NextState.m_strName if j.m_NextState != None else None}")
                text_data = []
                for k in list(j.m_allGetText.values()):
                    text_dic = {}
                    #print(f"TextView: ID: {k.viewID} Type: {k.inputType} content: {k.content}")
                    text_dic["text_view_id"] = k.viewID
                    text_dic["text_view_type"] = k.inputType
                    text_dic["text_view_content"] = k.content
                    text_dic["text_view_vbname"] = k.variableName
                    text_data.append(text_dic)
                event_dic["textView"] = text_data
                event_dic["click_type"] = ClickType
                if(j.m_NextState != None):
                    print(f"Nexstate {j.m_NextState.m_strName} !!!!!!!!!------------")
                event_dic["nextState"] = j.m_NextState.m_strName if j.m_NextState != None else None
                event_data.append(event_dic)
            view_dic["view_id"] = ViewID
            view_dic["view_data"] = event_data
            view_data.append(view_dic)
        state_dic["state_name"] = state_name
        state_dic["views_data"] = view_data
        return state_dic
                
    def FindIndexByID(self, ViewID):
        ReturnValue = None
        for i in range(len(self.m_ListView)):
            if(self.m_ListView[i].m_iID == ViewID):
                ReturnValue = i
                break
        return ReturnValue
    def SetCurrentViewEvent(self, _iViewID, _iEventValue):
        CurrentViewIndex = self.FindIndexByID(_iViewID)
        if(CurrentViewIndex != None):
            self.m_iIndex = CurrentViewIndex
            return self.m_ListView[CurrentViewIndex].SetCurrentEvent(_iEventValue)
        else: # All Butten Event not loading yet. We add this event first
            NewView = View() # add View 
            NewView.m_iID = _iViewID

            NewClickEvent = ClickEvent() # add New Click Event
            NewClickEvent.m_iType = _iEventValue
            NewClickEvent.parentViewID = _iViewID
            NewView.Add_Extend_ClickEvent([NewClickEvent])
            NewView.SetCurrentEvent(_iEventValue)

            # add New View to m_ListView Note: Don't use SetListView It will UpdateSignature not what We want
            self.m_ListView.append(NewView) 
            self.m_iTotalNumber = len(self.m_ListView)
            self.m_iIndex = len(self.m_ListView) - 1
            #print(f"SetCurrentViewEvent m_iIndex: {self.m_iIndex} total: {self.m_iTotalNumber}")
            return 0
    def add_extend_View(self, needaddView):
        tmpidx = self.FindIndexByID(needaddView.m_iID)
        if(tmpidx == None): # add
            self.m_ListView.append(needaddView)
        else: # extend
            self.m_ListView[tmpidx].Add_Extend_ClickEvent(needaddView.m_ListClickEvent)
        self.m_iTotalNumber = len(self.m_ListView)
        self.UpdateSignature()
    def getTextViewEvent(self, textViewID):
        for tmpview in self.m_ListView:
            TextEvent = tmpview.findTextViewEvent(textViewID)
            if TextEvent != None:
                return TextEvent
        return None
    def getAllText(self):
        AllText = []
        for tmpview in self.m_ListView:
            AllText.extend(tmpview.getAllTextView())
        return AllText

class VIEWEVENTTYPE(enum.IntEnum):
    ONCLICKLISTENER = 0
    ONLONGCLICKLISTENRER = 1
    ONFOCUSCHANGELISTENER = 2
    ONITEMCLICKLISTENER = 3
    ONITEMLONGCLICKLISTENRER = 4
    ONITEMSELECTEDLISTENER = 5
    ONCHECKEDCHANGELISTENER = 6

class View:
    def __init__(self):
        self.m_iID = 0
        self.m_iIndex = 0
        self.m_iTotalNumber = -1
        self.m_ListClickEvent = []
    def GetIndex(self):
        iEventValue = -1
        iItemIndex = -1
        #print('Index : {}, Total : {}'.format(self.m_iIndex,self.m_iTotalNumber))
        if(self.m_iIndex < self.m_iTotalNumber):
            TraceClickEvent = self.m_ListClickEvent[self.m_iIndex]
            iEventValue = TraceClickEvent.m_iType
            iItemIndex = TraceClickEvent.m_iIndex
        return iEventValue,iItemIndex
    def FinishEvent(self):
        self.m_iIndex += 1
    def GetCurrentEvent(self):
        ReturnValue = None
        print(f"mindex {self.m_iIndex}, total {self.m_iTotalNumber}")
        if(self.m_iIndex < self.m_iTotalNumber):
            ReturnValue = self.m_ListClickEvent[self.m_iIndex]
        return ReturnValue
    def GetEventIndexByTypeValue(self, TypeValue):
        ReturnValue = None
        for i in range(len(self.m_ListClickEvent)):
            if(self.m_ListClickEvent[i].m_iType == TypeValue):
                ReturnValue = i
        return ReturnValue
    def SetCurrentEvent(self, TypeValue):
        CueentEventIndex = self.GetEventIndexByTypeValue(TypeValue)
        if(CueentEventIndex != None):
            self.m_iIndex = CueentEventIndex
            return CueentEventIndex
        else:
            return -2
    def CheckClickEventAlreadyExists(self, traceClickEvent):
        for i in range(len(self.m_ListClickEvent)):
            if(self.m_ListClickEvent[i].m_iType == traceClickEvent.m_iType):
                return i
        return -1
    def Add_Extend_ClickEvent(self, _ListOfClickEvent):
        for i in range(len(_ListOfClickEvent)):
            tmpidx = self.CheckClickEventAlreadyExists(_ListOfClickEvent[i])
            if( tmpidx == -1 ):
                self.m_ListClickEvent.append(_ListOfClickEvent[i])
            else: # extend
                for textid in _ListOfClickEvent[i].m_allGetText.keys():
                    self.m_ListClickEvent[tmpidx].addEditTextRecord(_ListOfClickEvent[i].m_allGetText[textid])
                if self.m_ListClickEvent[tmpidx].m_NextState == None:
                    self.m_ListClickEvent[tmpidx].m_NextState = _ListOfClickEvent[i].m_NextState
        self.m_iTotalNumber = len(self.m_ListClickEvent)
    def findTextViewEvent(self, textViewID):
        for tmpevent in self.m_ListClickEvent:
            result = tmpevent.get_textView(textViewID)
            if(result != None):
                return tmpevent
        return None
    def getAllTextView(self):
        ReturnValue = []
        for tmpevent in self.m_ListClickEvent:
            ReturnValue.extend(tmpevent.getAllTextView())
        
        return ReturnValue

class ClickEvent:
    def __init__(self):
        self.m_iType = -1
        self.m_NextState = None
        self.m_iIndex = -1
        self.m_allGetText = {}
        self.parentViewID = None
    def SetNextState(self,_State):
        self.m_NextState = _State
    def GetNextState(self):
        return self.m_NextState
    def addEditTextRecord(self, View_EditText):
        if(View_EditText.viewID in self.m_allGetText):
            self.m_allGetText[View_EditText.viewID].update_content(View_EditText.content)
        else:
            self.m_allGetText[View_EditText.viewID] = View_EditText
    def get_textView(self, textViewID):
        ReturnValue = None
        if textViewID in self.m_allGetText:
            ReturnValue = self.m_allGetText[textViewID]
        return ReturnValue
    def getAllTextView(self):
        ReturnValue = []
        for textID in self.m_allGetText:
            ReturnValue.append(self.m_allGetText[textID])
        
        return ReturnValue
    
class StaticAutoModule:
    def __init__(self, issueState, inPathStateName):
        self.unTracedStateName = issueState
        self.tracedStateName = []
        self.inPathStateName = inPathStateName
        self.thread = None
        #print(issueState)
    def getUnTracedState(self): # [YuHeng]: 把 issueState pop 出來並回傳，然後將其加入 tracedStateName list
        returnState = None
        if len(self.unTracedStateName) > 0:
            returnState = self.unTracedStateName.pop(0)
            self.tracedStateName.append(returnState)
        return returnState
    def recoverTracedState(self): # [YuHeng]: 把 tracedStateName 從最後開始 pop，並且放到 unTracedStateName list
        if len(self.tracedStateName) > 0:
            recoverd = self.tracedStateName.pop(-1)
            self.unTracedStateName.append(recoverd)
    def setStateTraced(self, stateName):
        for _i in range(len(self.unTracedStateName)):
            if self.unTracedStateName[_i] == stateName:
                _tmp = self.unTracedStateName.pop(_i)
                self.tracedStateName.append(_tmp)
                return 0
        return -1
# for targeted orientation auto mode
class TargetedAutoModule:
    def __init__(self, can_visited_list, implicit_intent_dict):
        self.ListCanVisited = can_visited_list
        self.DictImplicitIntent = implicit_intent_dict
        self.ListUnVisitedState = []
        self.ListUnVisitedStateImplicitIntent = []
        self.ListCurrentVisitedState = None
        self.thread = None
        self.threadTimer = None
        self.DictTimeandVisitCount = {}
        # [YuHeng]: record Activities which can not be opened successfully
        self.ListCannotOpenedActivities = []
    # [YuHeng]: set self.m_ListVisitedState. There are all visited activities currently.
    def setCurrentVisitedState(self, currentVisitedState):
        self.ListCurrentVisitedState = currentVisitedState
    def unVisitedState(self): # [YuHeng]: find unvisited activities
        for state in self.ListCanVisited:
            if((state not in self.ListCurrentVisitedState) and (state not in self.ListCannotOpenedActivities)):
                self.ListUnVisitedState.append(state)
        # [YuHeng]: remove implicit intent from ListUnVisitedState
        # self.removeImplicitIntent()
    def dividedImplicitIntent(self): # [YuHeng]: find unvisited activities which need to use implicit intent
        for state in self.ListUnVisitedState:
            if self.DictImplicitIntent[state] != []:
                self.ListUnVisitedState.pop(self.ListUnVisitedState.index(state))
                self.ListUnVisitedStateImplicitIntent.append(state)

class OPCODETYPE(enum.IntEnum):
    FINISHACTION = 0
    CHANGESTATE = 1
    GETLISTBUTTONEVENT = 2
    EXECBUTTONEVENT = 3
    CHANGEMODE = 4
    CLIENTERROR = 5
    MANUALSELECTINDEX = 6
    PAUSE = 7
    START = 8
    RESUMEACTIVITY = 9
    PRESSBACKBUTTON = 10
    SETSTATE = 11
    SETSTATE_FINISH = 12
    SETSTATENAME = 13
    EDITTEXT_GET = 14
    VIEWPERFORMCLICKEVENT = 15
    # [YuHeng]: test Activity scanner
    ANDROID_RUNTIMEEXCEPTION = 16
class MODETYPE(enum.IntEnum):
    MANUAL = 0
    AUTO = 1
    PAUSE = 2
    EXIT = 3
    NAVIGATION = 4
    FUZZING = 5
    # [YuHeng]: for targeted orientation auto mode
    TAUTO = 6
    # [YuHeng]: for Activity scanner
    ASCAN = 7
    # [YuHeng]: for jump function mode
    TJUMP = 8

class ControlServer:
    def __init__(self, _iPort):
        self.m_iPort = _iPort
        self.m_ClientSocket = None
        self.m_DicStateButtonEvent = {}
        self.m_CurrentState = None
        self.m_CurrentDisplayActivity = None
        self.m_DicEventHandler = {}
        self.SetCurrentMode(MODETYPE.MANUAL)
        self.m_bActive = True
        self.m_iOldMode = self.m_iMode
        self.m_bFinished = False
        self.m_bHaveChangeState = False
        self.m_ListTraceState = []
        self.m_FirstState = None
        self.m_iProcessID = -1
        self.m_iMaxDepth = 100
        self.m_iCurrentDepth = 0
        self.m_iTryTimes = 1
        self.m_iMaxTry = 1
        self.m_ListUnknownState = []
        self.m_StartTime = 0
        self.m_bHavePressBack = False
        self.m_ActivityNow = None
        self.m_bIsKnownState = False
        self.m_bHaveChooseEvent = False
        self.m_ActivityBefore = None
        self.m_bIsResume = False
        self.m_ResumeState = None
        self.m_webMesg = ""
        self.m_NavHandler = None
        self.m_Packname = None
        self.m_FuzzHandler = None
        self.m_s_account = None # string
        self.m_s_password = None # string
        self.m_s_text = None # string
        self.m_StaticAuto = None
        self.m_bstaticAutoMode = False
        self.m_bsautoModePressBack = False
        self.m_ListVisitedState = []
        # [YuHeng]: for targeted orientation auto
        self.m_TargetedAuto = None
        self.m_TAutoActivityVisitCountAndTime = {}
        # [YuHeng]: for Frida mode. 0 is mean spawn way, 1 is mean attach being executed process way
        self.m_fmode = None
        # [YuHeng]: test Activity scanner
        self.m_problemActivityName = None
        self.m_ActivityScanner = None
        self.m_restartCount = -1
        self.m_RuntimeException_lock = False
        self.m_problemActivityFlag = False
        self.m_jumpTargetActivityName = None
        self.m_ActivityNameDiffFlag = False
        self.m_ActivityScannerStartTime = 0
        # [YuHeng]: record auto mode
        self.m_AutoModeStartTime = 0
        self.m_AutoModeTimerThread = None
        #self.m_ddebug = True
    def RestartInit(self):
        self.m_ClientSocket = None
        self.m_CurrentState = None
        self.m_DicEventHandler = {}
        self.SetCurrentMode(MODETYPE.MANUAL)
        self.m_bHaveChangeState = False
        self.m_ListTraceState = []
        self.m_iCurrentDepth = 0
        self.m_iTryTimes = 1
        self.m_iMaxTry = 1
        self.m_bHavePressBack = False
        self.m_ActivityNow = None
        self.m_bIsKnownState = False
        self.m_bHaveChooseEvent = False
        self.m_CurrentDisplayActivity = None
    # async def async_send(self, _str):
    #     await self.m_websocket.send_text(_str)
    def Start(self, websocket=None, packname=APPNAME):
        if CMDDEBUG:
            # [halloworld]: Thread(1): NewReadStdinThread => 吃指令, (ex: auto)
            NewReadStdinThread = threading.Thread(target=self.ReadStdinThread)
            NewReadStdinThread.start()
        self.m_websocket = websocket
        # [halloworld]: Thread(2): NewControlThread => RunFrida thread, 等待Socket連線，無限 Loop，接收 Tester.java
        self.NewControlThread = threading.Thread(target=self.ControlThread, args=(packname,))
        self.NewControlThread.start()
        
        if CMDDEBUG:
            try:
                NewReadStdinThread.join()
                NewControlThread.join()
            except:
                pass
    """
    [halloworld]: The Command For Testing:
    exit: 把 CmdServer kill 掉
    auto: 自動模式，for diva
    manual: 手動模式，單純只蒐集log
    back: 返回event
    full: FulfillAllEditText
    next: 
    showall: 查看 activity 和 View 的對應關係
    loadjson:
    loadcurr:
    save_record:
    goto: navigation_handler
    show:
    fuzz: 指定fuzz editext的id做fuzzing
    setpa:
    getCurr: 現在所在state(activity)
    sauto: 
    shows:
    sets:
    """
    def ReadStdinThread(self):
        # self.m_print("Stdin thread start!!")
        # [halloworld]: 接收指令
        while(1):
            try:
                InputValue = input()
            except:
                #self.m_print('Stdin Receive Interrupt')
                #self.m_print(os.getpid())
                self.KillSelf()
                self.m_bActive = False
            if(InputValue == "exit"):
                self.KillSelf()
            elif(InputValue == "auto"):
                if self.m_CurrentState != None:
                    self.StartAutoMode()
            elif(InputValue == "manual"):
                self.m_ClientSocket.send(struct.pack(">I",0))
                self.SetCurrentMode(MODETYPE.MANUAL)
            elif(InputValue == "back"):
                self.SendPressBackButtonEvent()
            elif(InputValue == "full"):
                self.m_ClientSocket.send(struct.pack(">I",14))
            elif(InputValue == "next"):
                #self.m_print("Next Step")
                #m_Modeself.m_ClientSocket.send(struct.pack(">I",0))
                m_NextStep = True
            elif(InputValue == "showall"):
                json_state = []
                for i in list(self.m_DicStateButtonEvent.values()):
                    print(f"State: {i.m_strName}")
                    json_state.append(i.list_all_Record(i.m_strName))
                print(json.dumps(json_state))
            # load from pre store json
            elif(InputValue == "loadjson"): 
                with open(f"app_record/{self.m_Packname}.json") as f:
                    data = json.load(f)
                self.Load_Json_To_Self(data)
                if(self.m_NavHandler != None):
                    self.m_NavHandler.add_record(data)
                else:
                    self.m_NavHandler = Navigation_Handler(record(data))
            # load current record
            elif(InputValue == "loadcurr"): 
                data = json.loads(self.Load_current_record())
                if(self.m_NavHandler != None):
                    self.m_NavHandler.add_record(data)
                else:
                    self.m_NavHandler = Navigation_Handler(record(data))
            elif(InputValue == "save_record"):
                data = self.Load_current_record()
                with open(f"app_record/{self.m_Packname}.json", "w") as f:
                    f.write(data)
            elif(InputValue == "goto"):
                if(self.m_NavHandler != None):
                    GoToStateName = input("State:")
                    self.StartNavigation(self.m_CurrentDisplayActivity, GoToStateName)
            elif(InputValue == "show"):
                self.m_NavHandler.Show_map()
            elif(InputValue == "fuzz"):
                if(self.m_CurrentState != None):
                    FuzzID = input("ID:")
                    self.StartFuzzing(int(FuzzID))
                else:
                    print("Load record first or no Current state")
            elif(InputValue == "setpa"):
                tmp_account = input("account: ")
                tmp_password = input("password: ")
                tmp_normalText = input("text: ")
                self.Send_SetAcntPwd(tmp_account, tmp_password, tmp_normalText)
            elif(InputValue == "getCurr"):
                print(self.m_CurrentState.m_strName)
            elif(InputValue == "sauto"):
                self.StartStaticAuto()
            elif(InputValue == "shows"):
                SendMessage = struct.pack(">B",18)
                self.m_ClientSocket.send(SendMessage)
            elif(InputValue == "sets"):
                _stateName = input("Name:")
                SendMessage = struct.pack(">BI",17, len(_stateName))
                SendMessage += _stateName.encode()
                self.m_ClientSocket.send(SendMessage)     
    # [YuHeng]: for Frida attach mode
    def FindStartActivity(self, _PackageName):
        # [YuHeng]: input command to list target apk's package information
        p1 = subprocess.Popen(['adb', '-s', SETTING.DEVICEID, 'shell', 'dumpsys', 'package', _PackageName], stdout=subprocess.PIPE, stderr=subprocess.PIPE, shell=True)
        output, err = p1.communicate()
        flag = 0
        finish_flag = 0
        main_activity = ""
        if output:
            for line in output.decode().split('\r\n'):
                # print(f"line: {line}")
                if flag == 0:
                    if 'android.intent.action.MAIN' in line:
                        flag = 1
                else:
                    line_list = line.split()
                    for sub_line in line_list:
                        # print(sub_line)
                        if _PackageName in sub_line:
                            main_activity = sub_line
                            print(f'The subline for {_PackageName} is: {sub_line}')
                            finish_flag = 1
                            break
                if finish_flag == 1:
                    break
        if err:
            print(f'No main activity found for {_PackageName}')

        if main_activity != "":
            main_activity_name = main_activity.split('/')[-1]
            return main_activity_name
        else:
            return ""
    # [YuHeng]: Thread(3)
    def RunFrida(self, _PackageName):
        frida_mgr = frida.get_device_manager()
        device = None
        for tmpdevice in frida_mgr.enumerate_devices():
            if(tmpdevice.id == SETTING.DEVICEID):
                device = tmpdevice
        assert device != None
        # self.m_iProcessID = device.spawn([_PackageName])
        # session = device.attach(self.m_iProcessID)
        # session = device.attach('MyNewDiva')
        
        # [YuHeng]: Frida attach to being executed process
        main_activity = self.FindStartActivity(_PackageName)
        if main_activity != "":
            p1 = subprocess.Popen(['adb', '-s', SETTING.DEVICEID, 'shell', 'ps', '-e', '|', 'grep', _PackageName], stdout=subprocess.PIPE)
            output, err = p1.communicate()
            if output:
                # print(output.decode().split())
                print("[Frida status]: Using 'attach' way to start APP.")
                self.m_iProcessID = int(output.decode().split()[1])
                # print("1 PID: ", self.m_iProcessID)
                session = device.attach(self.m_iProcessID)
                self.m_fmode = 1
            else:
                print("[Frida status]: Using 'spawn' way to start APP.")
                gadget_path = "/root/.cache/frida/gadget-android-x86_64.so"
                self.m_iProcessID = device.spawn([_PackageName], env={"LD_PRELOAD": gadget_path})
                # self.m_iProcessID = device.spawn([_PackageName])
                session = device.attach(self.m_iProcessID)
                self.m_fmode = 0
        else: # [YuHeng]: if we can not find main activity name, we use spawn way to start app.
            print("[Frida status]: Don't find any entry point so using 'spawn' way to start APP.")
            self.m_iProcessID = device.spawn([_PackageName])
            session = device.attach(self.m_iProcessID)
            self.m_fmode = 0
        # [YuHeng]: 接收從Code.js回傳的message
        def on_message(message, data):
            self.m_print(message)
        with open("/AndroidDynamicSystem/Frida/Code.js") as f:
            script = session.create_script(f.read())
        script.on('message', on_message)
        print(f"[Frida Debug] Attached to PID {self.m_iProcessID}")
        script.load()
        print("[Frida Debug] Script loaded successfully")
        time.sleep(1)

        if self.m_fmode == 0:
            device.resume(self.m_iProcessID)
        else:
            os.system('adb -s {} shell am start -n {}/{}'.format(SETTING.DEVICEID, _PackageName, main_activity))
        # time.sleep(1)
        # frida.resume(self.m_iProcessID)
        
    # [YuHeng]: Thread(2)
    def ControlThread(self, packname): 
        PackageName = packname
        self.m_Packname = packname
        # PackageName = "com.yuanta.globalplus"
        # [halloworld]: adb clear the APP's Data & Log
        os.system('adb -s {} root'.format(SETTING.DEVICEID)) # check adb is root mode
        os.system('adb connect {}'.format(SETTING.DEVICEID))
        os.system('adb -s {} shell "rm /data/data/{}/files/LogFile.txt"'.format(SETTING.DEVICEID, PackageName))
        os.system('adb -s {} shell "am force-stop {}"'.format(SETTING.DEVICEID, PackageName))
        os.system('adb -s {} shell "pm clear {}"'.format(SETTING.DEVICEID, PackageName))
        
        self.m_StartTime = time.time()
        ListenSocket = self.StartListen()

        self.m_print("Start Server")
        self.m_DicStateButtonEvent = {}
        bChooseButtonEvent = False
        bChangeActivity = False
        bRunNextButtonEvent = False
        self.m_CurrentState = None
        ParentSelectIndex = -1
        iSelectIndex = -1

        # [halloworld]: keep Java socket
        while True:
            if self.m_iMode == MODETYPE.EXIT:
                break
            # [YuHeng]: test Activity Scanner
            self.m_restartCount += 1
            # print("[+] Current mode: {}".format(self.m_iMode))
            self.m_print('Restart!!!!!!!!!!!!!!!!!!!')
            self.RestartInit()
            #os.system("adb shell am start -n com.libertex.mobile/.MainActivity")
            #os.system("adb shell am start -n com.yahoo.mobile.client.android.finance/.main.MainActivity")
            #os.system("adb shell am start -n com.example.droidtest1/.MainActivity")
            
            # RunFrida
            NewThread = threading.Thread(target=self.RunFrida, args=[PackageName])
            NewThread.start()
            (self.m_ClientSocket, ClientAddress) = ListenSocket.accept()
            if (self.m_s_account != None and 
                self.m_s_password != None and 
                self.m_s_text != None):
                self.Send_SetAcntPwd(self.m_s_account, self.m_s_password, self.m_s_text)
            #self.m_print('Accept!!')
            self.m_ClientSocket.setblocking(True)
            
            ##self.m_print("Client Info: ", self.m_ClientSocket, ClientAddress)
            bAutoSelect = False
            # [halloworld]: recv from Java socket 
            while True:
                if self.m_iMode == MODETYPE.EXIT:
                    break
                iTimeout = 800 #800
                if self.m_iMode == MODETYPE.AUTO:
                    iTimeout = 80
                self.m_ClientSocket.settimeout(iTimeout)
                try:
                    self.m_print('Start Receive : timeout : {}'.format(iTimeout))
                    Recvmsg = self.m_ClientSocket.recv(4)
                    if self.m_iMode == MODETYPE.EXIT:
                        break
                except:
                    if self.m_iMode == MODETYPE.EXIT:
                        break
                    self.m_print("Client hang, this button set disable")
                    if self.m_CurrentState != None:
                        self.m_CurrentState.FinishEvent()
                        if self.m_CurrentState.HaveFinishAllEvent():
                            self.m_CurrentState.m_bHaveTraced = True
                            self.RemoveRecursively()
                        # self.m_print('Press Back')
                        # os.system("adb shell 'kill {0}'".format(self.m_iProcessID))
                        # os.system(" adb shell \"echo `ps -A | grep {0} | awk '{{print $2}}'`\"".format(PackageName))
                        # print(" adb shell \"echo `ps -A | grep {0} | awk '{{print $2}}'`\"".format(PackageName))
                        # os.system(" adb shell \"echo `ps -A | grep '^u0_i' | awk '{print $2}' | tail -n 1`\"")

                        #adb shell "kill `ps -A | grep '^u' | awk '{print `$2}' | tail -n 1`"
                        time.sleep(3)
                        #self.m_bHavePressBack = True
                        #self.SendPressBackButtonEvent()
                    break

                # [halloworld]: 沒收到訊息跳 Disconnect
                if len(Recvmsg) == 0:
                    self.m_print("Client Disconnect")
                    if self.m_CurrentState != None:
                        self.m_CurrentState.FinishEvent()
                        # [YuHeng]: 紀錄 crash 之前的 State
                        print("[+] Crash activity: {}".format(self.m_CurrentState.m_strName))
                        self.m_RuntimeException_lock = True
                        
                        self.m_BeforeCrashState = self.m_CurrentState
                        if self.m_CurrentState.HaveFinishAllEvent():
                            self.m_CurrentState.m_bHaveTraced = True
                            self.RemoveRecursively()
                    #os.system("adb shell 'pm clear {0}'".format(PackageName))
                    #os.system("adb -s {0} shell \"kill `ps -A | grep {1} | awk '{{print $2}}'`\"".format(SETTING.DEVICEID, PackageName))
                    #os.system("adb -s {0} shell \"kill `ps -A | grep '^u0_i' | awk '{print $2}' | tail -n 1`\"".format(SETTING.DEVICEID))
                    #time.sleep(3)
                    '''
                    if(self.m_CurrentState != None):
                        self.m_CurrentState.ForceFinish()
                        iEventValue, iViewIndex, iItemIndex = self.m_CurrentState.GetIndex()
                        print('select EventValue : {}, ViewIndex : {}, ItemIndex : {}'.format(iEventValue,iViewIndex,iItemIndex))
                        if(self.m_iMode == MODETYPE.AUTO and iViewIndex == -1):
                            self.m_CurrentState.FinishAll()
                            self.RemoveRecursively()
                    self.m_ClientSocket.close()
                    '''
                    break
                
                # [halloworld]: 有收到訊息做事
                # [YuHeng]: 接收 tester.java 的資訊
                #self.m_print('Recv 4 byte : ' + str(Recvmsg))
                iLength = struct.unpack(">I",Recvmsg[:4])[0]
                #iLength = Recvmsg[0]
                #self.m_print('Recv Length : ' + str(iLength))
                Recvmsg = self.m_ClientSocket.recv(iLength)
                self.m_print(Recvmsg)
                #self.m_ClientSocket.send(b'\x00')
                Opcode = struct.unpack("B",Recvmsg[0].to_bytes(1,'little'))[0]
                aa = '\\x'.join(['%02x' % (struct.unpack("B",b.to_bytes(1,'little'))) for b in Recvmsg])
                # self.m_print(aa)
                self.m_print("Opcode : " + str(Opcode))
                Recvmsg = Recvmsg[1:]
                # self.m_print("Recvmsg : " + str(Recvmsg))
                bRunNextButtonEvent = False
                if (Opcode in self.m_DicEventHandler):
                    #self.m_print('Yes')
                    self.m_DicEventHandler[Opcode](Recvmsg)
                '''
                if(self.m_bFinished):
                    self.m_print('Finish')
                    try:
                        os.system("adb shell kill {0}".format(self.m_iProcessID))
                    except:
                        pass
                    break
                '''
                # [YuHeng]: test Activity Scanner
                # print("status of lock: {}".format(self.m_RuntimeException_lock))
                if((self.m_restartCount>0) and (self.m_RuntimeException_lock==True)):
                    if(Opcode == 0):
                        self.m_RuntimeException_lock = False
                        if self.m_ActivityScanner.thread != None:
                            if self.m_ActivityScanner.thread.is_alive():
                                print("1 Current Mode: {}".format(self.m_iMode))
                                self.m_ActivityScanner.ListCannotOpenedActivities.append(self.m_problemActivityName)
                                # [YuHeng]: init value
                                self.InitJumpValueAfterCrashEvent()
                                self.SetCurrentMode(MODETYPE.ASCAN)
                        elif self.m_TargetedAuto.thread != None:
                            if self.m_TargetedAuto.thread.is_alive():
                                print("2 Current Mode: {}".format(self.m_iMode))
                                self.m_TargetedAuto.ListCannotOpenedActivities.append(self.m_problemActivityName)
                                # [YuHeng]: init value
                                # self.InitJumpValueAfterCrashEvent()
                                self.SetCurrentMode(MODETYPE.TAUTO)
                        elif self.m_TargetedAuto != None:
                            if self.m_TargetedAuto.thread == None:
                                self.m_TargetedAuto.ListCannotOpenedActivities.append(self.m_problemActivityName)
                                # [YuHeng]: init value
                                self.InitJumpValueAfterCrashEvent()
                                print("3 m_problemActivityFlag: {}".format(self.m_problemActivityFlag))
                                self.SetCurrentMode(MODETYPE.MANUAL)
                        # print("status of lock: {}".format(self.m_RuntimeException_lock))
                        # print("Current Mode: {}".format(self.m_iMode))
                        # print("[Problem]: {}".format(self.m_problemActivityName))
                        # self.StartActivityScannerMode()
        self.m_print("-----------------Control Server STOP!!!!!!!!----------\n")
    def InitJumpValueAfterCrashEvent(self):
        self.m_problemActivityName = None
        self.m_problemActivityFlag = False
        self.m_ActivityNameDiffFlag = False
        self.m_jumpTargetActivityName = None
    def m_print(self, _str):
        self.m_webMesg += str(_str) + "\n"
        print(_str)
    def get_webMesg(self):
        if(self.m_iMode == MODETYPE.EXIT):
            return -1
        tmp = self.m_webMesg
        self.m_webMesg = ""
        return tmp
    def InitEventHandler(self):
        self.m_DicEventHandler = {}
        if(self.m_iMode == MODETYPE.AUTO):
            self.m_print("Init AUTO")
            print(datetime.now().time())
            self.m_DicEventHandler[OPCODETYPE.FINISHACTION] = self.Event_FinishExecute
            self.m_DicEventHandler[OPCODETYPE.CHANGESTATE] = self.Event_ChangeState # <=> SendAllButtonEvent(Tester.java)
            self.m_DicEventHandler[OPCODETYPE.CLIENTERROR] = self.Event_ClientError
            self.m_DicEventHandler[OPCODETYPE.MANUALSELECTINDEX] = self.Event_ManualButtonClick
            self.m_DicEventHandler[OPCODETYPE.PAUSE] = self.Event_Pause
            self.m_DicEventHandler[OPCODETYPE.START] = self.Event_Start
            self.m_DicEventHandler[OPCODETYPE.RESUMEACTIVITY] = self.Event_ResumeActivity
            self.m_DicEventHandler[OPCODETYPE.EDITTEXT_GET] = self.Event_GetEditText
        elif(self.m_iMode == MODETYPE.NAVIGATION):
            self.m_DicEventHandler[OPCODETYPE.CHANGESTATE] = self.Event_ChangeState
            self.m_DicEventHandler[OPCODETYPE.PAUSE] = self.Event_Pause
            self.m_DicEventHandler[OPCODETYPE.START] = self.Event_Start
            self.m_DicEventHandler[OPCODETYPE.RESUMEACTIVITY] = self.Event_ResumeActivity
        elif(self.m_iMode == MODETYPE.FUZZING):
            self.m_DicEventHandler[OPCODETYPE.FINISHACTION] = self.Event_FuzzDoNext
            self.m_DicEventHandler[OPCODETYPE.PAUSE] = self.Event_Pause
            self.m_DicEventHandler[OPCODETYPE.START] = self.Event_Start
            self.m_DicEventHandler[OPCODETYPE.RESUMEACTIVITY] = self.Event_ResumeActivity
            #self.m_DicEventHandler[OPCODETYPE.CHANGESTATE] = self.Event_ChangeState
        elif(self.m_iMode == MODETYPE.ASCAN): # [YuHeng]: test Activity scanner
            self.m_DicEventHandler[OPCODETYPE.CHANGESTATE] = self.Event_ChangeState
            self.m_DicEventHandler[OPCODETYPE.PAUSE] = self.Event_Pause
            self.m_DicEventHandler[OPCODETYPE.START] = self.Event_Start
            self.m_DicEventHandler[OPCODETYPE.RESUMEACTIVITY] = self.Event_ResumeActivity
            self.m_DicEventHandler[OPCODETYPE.EDITTEXT_GET] = self.Event_GetEditText
            self.m_DicEventHandler[OPCODETYPE.VIEWPERFORMCLICKEVENT] = self.Event_ViewClicked
            self.m_DicEventHandler[OPCODETYPE.ANDROID_RUNTIMEEXCEPTION] = self.Exception_Record
        else:
            #self.m_DicEventHandler[OPCODETYPE.FINISHACTION] = self.Event_FinishExecute
            self.m_DicEventHandler[OPCODETYPE.FINISHACTION] = self.ManaulToAuto
            self.m_DicEventHandler[OPCODETYPE.CHANGESTATE] = self.Event_ChangeState
            #self.m_DicEventHandler[OPCODETYPE.CLIENTERROR] = self.Event_ClientError
            self.m_DicEventHandler[OPCODETYPE.MANUALSELECTINDEX] = self.Event_ManualButtonClick
            self.m_DicEventHandler[OPCODETYPE.PAUSE] = self.Event_Pause
            self.m_DicEventHandler[OPCODETYPE.START] = self.Event_Start
            self.m_DicEventHandler[OPCODETYPE.RESUMEACTIVITY] = self.Event_ResumeActivity
            self.m_DicEventHandler[OPCODETYPE.EDITTEXT_GET] = self.Event_GetEditText
            self.m_DicEventHandler[OPCODETYPE.VIEWPERFORMCLICKEVENT] = self.Event_ViewClicked
            # [YuHeng]: test Activity scanner
            self.m_DicEventHandler[OPCODETYPE.ANDROID_RUNTIMEEXCEPTION] = self.Exception_Record

        #self.m_DicEventHandler[OPCODETYPE.CHANGEMODE] = self.FinishExecute
    def ManaulToAuto(self, _Input):
        # if self.m_ddebug:
        #     self.m_ddebug = False
        #     with open(f"app_record/{self.m_Packname}.json") as f:
        #         data = json.load(f)
        #     self.Load_Json_To_Self(data)
        #     if(self.m_NavHandler != None):
        #         self.m_NavHandler.add_record(data)
        #     else:
        #         self.m_NavHandler = Navigation_Handler(record(data))
        #     self.StartStaticAuto()
        if (self.m_StaticAuto != None and 
            self.m_bstaticAutoMode and 
            self.m_iMode == MODETYPE.MANUAL):
            self.m_bstaticAutoMode = False
    def UpdateListHistory(self):
        #self.m_print('Update List History')
        if(self.m_CurrentState in self.m_ListTraceState):
            self.m_ListTraceState = self.m_ListTraceState[:self.m_ListTraceState.index(self.m_CurrentState)+1]

        iListCount = len(self.m_ListTraceState)
        for i in range(iListCount-1,-1,-1):
            TraceState = self.m_ListTraceState[i]
            if(TraceState.m_bIsActivity):
                self.m_ActivityNow = TraceState
                break
    #  self.InitEventHandler()
    def SetCurrentMode(self, modType):
        if (modType == MODETYPE.AUTO):
            self.m_iMode = MODETYPE.AUTO
        elif (modType == MODETYPE.NAVIGATION):
            self.m_iMode = MODETYPE.NAVIGATION
        elif (modType == MODETYPE.EXIT):
            self.m_iMode = MODETYPE.EXIT
        elif (modType == MODETYPE.PAUSE):
            self.m_iMode = MODETYPE.PAUSE
        elif (modType == MODETYPE.FUZZING):
            self.m_iMode = MODETYPE.FUZZING
        # [YuHeng]: for targeted orientation auto mode
        elif (modType == MODETYPE.TAUTO):
            self.m_iMode = MODETYPE.TAUTO
        # [YuHeng]: for jump function mode
        elif (modType == MODETYPE.TJUMP):
            self.m_iMode = MODETYPE.TJUMP
        # [YuHeng]: for Activity Scanner mode
        elif (modType == MODETYPE.ASCAN):
            self.m_iMode = MODETYPE.ASCAN
        else:
            self.m_iMode = MODETYPE.MANUAL
        self.InitEventHandler()
    def Event_ResumeActivity(self,_Input):
        self.m_print('\nEvent_ResumeActivity')

        StateName_Length = struct.unpack(">I",_Input[:4])[0]
        _Input = _Input[4:]
        StateName = struct.unpack("{0}s".format(StateName_Length), _Input[:StateName_Length])[0].decode()
        print("Resume State: ",StateName)

        if StateName not in self.m_ListVisitedState: # 檢查是否為已經訪問過的 activity 如果不是的話就將其加入 m_ListVisitedState list
            self.m_ListVisitedState.append(StateName)
        self.m_CurrentDisplayActivity = StateName
        self.m_ResumeState = None
        self.m_bIsResume = True
        # if(self.m_iMode == MODETYPE.AUTO):
        #    self.m_ClientSocket.send(b'\x0E') #guo add fulfillText
        #print("send fulfillText Cmd")
        if(StateName in self.m_DicStateButtonEvent):
            self.m_ResumeState = self.m_DicStateButtonEvent[StateName]
            print("[resumestate]: " + self.m_ResumeState.m_strName)
            if(self.m_bHavePressBack):
                self.m_bHavePressBack = False
        if(self.m_iMode == MODETYPE.NAVIGATION):
            action = self.m_NavHandler.Event_ResumeActivity(StateName)
            if action != None:
                #print("SendAction !!!!!!!")
                self.m_ClientSocket.send(action)
            else:
                print("NAVIGATION Done!!!!!!",datetime.now().time())
                self.m_bHaveChangeState = False
                time.sleep(1.2)
                self.SetCurrentMode(MODETYPE.MANUAL)
        if(self.m_iMode == MODETYPE.FUZZING):
            if self.m_FuzzHandler != None:
                self.m_FuzzHandler.Event_ResumeActivity(StateName)
            else:
                print("self.m_FuzzHandler == None")
                self.SetCurrentMode(MODETYPE.MANUAL)
        # [YuHeng]: Check display activity name == target activity name after jumping
        if(self.m_jumpTargetActivityName != None):
            if(self.m_jumpTargetActivityName != self.m_CurrentDisplayActivity):
                print("[YuHeng]: self.m_CurrentDisplayActivity: {}".format(self.m_CurrentDisplayActivity))
                print("[YuHeng]: self.m_jumpTargetActivityName: {}".format(self.m_jumpTargetActivityName))
                self.m_ActivityNameDiffFlag = True
            else:
                self.m_ActivityNameDiffFlag = False
        if(self.m_iMode == MODETYPE.TJUMP):
            # [YuHeng]: for Activity Scanner mode
            if self.m_ActivityScanner.thread != None:
                if(self.m_ActivityScanner.thread.is_alive()):
                    if StateName not in list(self.m_TAutoActivityVisitCountAndTime.values()):
                        lapTime = time.time() - self.m_ActivityScannerStartTime
                        self.m_TAutoActivityVisitCountAndTime[lapTime] = StateName
                    self.SetCurrentMode(MODETYPE.ASCAN)
                    print("[+] Set mode to ASCAN")
            else:
                # [YuHeng]: targetedAuto mode
                if self.m_TargetedAuto.thread != None:
                    if self.m_TargetedAuto.thread.is_alive():
                        if StateName not in list(self.m_TAutoActivityVisitCountAndTime.values()):
                            lapTime = time.time() - self.m_TargetedAutoStartTime
                            self.m_TAutoActivityVisitCountAndTime[lapTime] = StateName
                        self.SetCurrentMode(MODETYPE.TAUTO)
                        print("[+] Set mode to TAUTO")
                # [YuHeng]: jump directly mode
                else:
                    self.SetCurrentMode(MODETYPE.MANUAL)
                    print("[+] Set mode to MANUAL")
    def Event_GetEditText(self, _Input):
        if(len(_Input) > 0):
            print("Event_GetEditText")
            EditTextID = struct.unpack(">I",_Input[:4])[0]
            _Input = _Input[4:]
            EditTextInputType = struct.unpack(">I",_Input[:4])[0]
            _Input = _Input[4:]
            TextLength = struct.unpack(">I",_Input[:4])[0]
            _Input = _Input[4:]
            try:
                EditTextText = struct.unpack("{0}s".format(TextLength),_Input[:TextLength])[0].decode()
            except: # If the Text cannot be deocde in UTF-8 (we should change the store way)
                print("Parse EditTextText Error!")
                EditTextText = ""
            _Input = _Input[TextLength:]

            VariableNameLength = struct.unpack(">I",_Input[:4])[0]
            _Input = _Input[4:]
            try:
                VariableName = struct.unpack("{0}s".format(VariableNameLength),_Input[:VariableNameLength])[0].decode()
            except: # If the Text cannot be deocde in UTF-8 (we should change the store way)
                print("Parse Variable Name Error!")
                VariableName = ""

            nowText = EditText(_id=EditTextID, _type=EditTextInputType, content=EditTextText, vbName = VariableName)
            Current_event = self.m_CurrentState.GetCurrentEvent()
            if(Current_event != None):
                Current_event.addEditTextRecord(nowText)
                ViewID = self.m_CurrentState.GetCurrentView().m_iID
                EventType = Current_event.m_iType
                print(f"Button ID: {ViewID} Button click type: {EventType} add EditText")
                print(f"ID: {EditTextID} Type: {EditTextInputType} Text: {EditTextText} Name: {VariableName} Edit_textcalled ")
            else:
                print("Event_GetEditText self.m_CurrentState.GetCurrentEvent() == None")  
    # [YuHeng]: Opcode:15 當按下 button 時，Tester.java 就會呼叫這個 function，如果 m_DicStateButtonEvent 沒有記錄到這個 button 的話會把這個 button 記錄下來
    def Event_ViewClicked(self, _Input):
        if(len(_Input) > 0):
            ClickedViewID = struct.unpack(">I",_Input[:4])[0]
            _Input = _Input[4:]
            ClickedViewType = struct.unpack("B",_Input[0].to_bytes(1,'little'))[0]
            _Input = _Input[1:]
            print(f"ClickedViewID: {ClickedViewID}, ClickedViewType: {ClickedViewType}")
            StateName = self.m_CurrentDisplayActivity
            if (StateName not in self.m_DicStateButtonEvent):
                NewState = StateButtonEvent(StateName)
                self.m_DicStateButtonEvent[StateName] = NewState
            retval = self.m_DicStateButtonEvent[StateName].SetCurrentViewEvent(ClickedViewID, ClickedViewType)
            if(retval < 0):
                print("Set CurrentState Failed ",retval)
            if(self.m_CurrentState != None):
                if(self.m_CurrentState.m_strName != StateName):
                    self.m_CurrentState = self.m_DicStateButtonEvent[StateName]
                    print("set current state: ", self.m_CurrentState.m_strName)


            # if(self.m_iMode == MODETYPE.MANUAL): # for MANUAL
            #     retval = self.m_DicStateButtonEvent[self.m_CurrentDisplayActivity].SetCurrentViewEvent(ClickedViewID, ClickedViewType)
            # else: #for Auto
            #     retval = self.m_CurrentState.SetCurrentViewEvent(ClickedViewID, ClickedViewType)
            # if(retval < 0):
            #     print("Set CurrentState Failed ",retval)
    def Event_Pause(self,_Input):
        #self.m_print("Event_Pause")
        self.m_iOldMode = self.m_iMode
        self.SetCurrentMode(MODETYPE.PAUSE)
    def Event_Start(self,_Input):
        #self.m_print("Event_Start")
        self.SetCurrentMode(self.m_iOldMode)
    def GetListView(self,_Input):
        ListView = []
        #Event Value, View id, Others
        while(len(_Input) > 0):
            #self.m_print(len(_Input))
            # [YuHeng]: Event value 代表該 activity 中所 hook 到的 Listener type
            iEventValue = struct.unpack(">I",_Input[:4])[0]
            _Input = _Input[4:]
            # [YuHeng]: View id 代表那些 listener button 的 id
            iViewID = struct.unpack(">I",_Input[:4])[0]
            _Input = _Input[4:]
            iItemCount = -1
            
            if((iEventValue & (1 << VIEWEVENTTYPE.ONITEMCLICKLISTENER) != 0) or (iEventValue & (1 << VIEWEVENTTYPE.ONITEMLONGCLICKLISTENRER) != 0) or (iEventValue & (1 << VIEWEVENTTYPE.ONITEMSELECTEDLISTENER) != 0)):
                #self.m_print('Here')
                iItemCount = struct.unpack(">I",_Input[:4])[0]
                _Input = _Input[4:]
            #self.m_print('EventType : {}, ViewID :  {}, ItemCount : {}'.format(iEventValue,iViewID,iItemCount))
            ListView.append(self.GetView(iViewID,iEventValue,iItemCount))
        #self.m_print('Finished')
        return ListView
    def Load_current_record(self):
        json_state = []
        for i in list(self.m_DicStateButtonEvent.values()):
            json_state.append(i.list_all_Record(i.m_strName))
        return json.dumps(json_state)
    def GetView(self,_iViewID,_iEventValue,_iItemCount):
        ReturnValue = View()
        ReturnValue.m_iID = _iViewID
        #self.m_print('Event Value : ' + str(_iEventValue))
        for i in range(7):
            if((_iEventValue & (1<<i)) != 0):
                #self.m_print(i)
                if(i == VIEWEVENTTYPE.ONITEMCLICKLISTENER or i == VIEWEVENTTYPE.ONITEMLONGCLICKLISTENRER or i == VIEWEVENTTYPE.ONITEMSELECTEDLISTENER):
                    #self.m_print('Item Option : Count : {}'.format(_iItemCount))
                    if(_iItemCount < 1000):
                        _iItemCount = min(_iItemCount,20)
                        for j in range(_iItemCount):
                            NewClickEvent = ClickEvent()
                            NewClickEvent.m_iType = i
                            NewClickEvent.parentViewID = _iViewID
                            NewClickEvent.m_iIndex = j
                            ReturnValue.m_ListClickEvent.append(NewClickEvent)
                else:
                    NewClickEvent = ClickEvent()
                    NewClickEvent.m_iType = i
                    NewClickEvent.parentViewID = _iViewID
                    ReturnValue.m_ListClickEvent.append(NewClickEvent)
        ReturnValue.m_iTotalNumber = len(ReturnValue.m_ListClickEvent)
        return ReturnValue
    def Event_ManualButtonClick(self,_Input):
        #self.m_print("Event_ManualButtonClick")
        iIndex = struct.unpack(">I",_Input[:4])[0]
        #self.m_print('Select Index : ' + str(iIndex))
    def doAutoModeRecordTimer(self):
        DictTimeandVisitCount = {'Time':[], self.m_Packname:[]}
        tempCount = 0
        while True:
            if self.m_iMode==MODETYPE.AUTO:
                tempCount = len(self.m_ListVisitedState)
                DictTimeandVisitCount['Time'].append(time.time()-self.m_AutoModeStartTime)
                DictTimeandVisitCount[self.m_Packname].append(tempCount)
            else:
                break
            time.sleep(2)
        print("[YuHeng]: Auto mode Timer is done!")
        for k, v in DictTimeandVisitCount.items():
            print("{}: {}".format(k, v))
    def StartAutoMode(self):
        self.SetCurrentMode(MODETYPE.AUTO)
        # [YuHeng]: add by YuHeng
        self.m_AutoModeStartTime = time.time()
        self.m_AutoModeTimerThread = threading.Thread(target=self.doAutoModeRecordTimer)
        self.m_AutoModeTimerThread.start()

        self.m_ListTraceState = []
        # [halloworld]: 如果 CurrentState != 目前顯示的 Activity
        if(self.m_CurrentState.m_strName != self.m_CurrentDisplayActivity):
            print("[YuHeng]: 1 CurrentState => {}".format(self.m_CurrentState.m_strName))
            if self.m_ResumeState != None:
                self.m_CurrentState = self.m_ResumeState
            print("[YuHeng]: 2 CurrentState => {}".format(self.m_CurrentState.m_strName))
        self.m_print('Start Base : ' + self.m_CurrentState.m_strName)
        self.m_ActivityNow = self.m_CurrentState
        self.m_ActivityBefore = self.m_CurrentState
        self.m_ListTraceState.append(self.m_CurrentState)
        self.m_bHaveChangeState = True
        print("Start Auto m_bHaveChangeState true")
        self.initAllState()
        # Fulfill all text => Tester.java (case 14)
        # self.m_ClientSocket.send(b'\x0E')
        # [OPCODETYPE.FINISHACTION](None) is meaning call Event_FinishExecute()
        self.m_DicEventHandler[OPCODETYPE.FINISHACTION](None)
    # [YuHeng]: guo's special auto mode
    def doStaticAuto(self):
        if len( self.m_StaticAuto.unTracedStateName ) > 0:
                # [YuHeng]: 如果導航模式的 record 有記錄東西的話
                if self.m_NavHandler != None:
                    stateLength = len( self.m_StaticAuto.unTracedStateName )
                    for i in range(stateLength):
                        GoToStateName = self.m_StaticAuto.getUnTracedState() # [YuHeng]: 就是除了 MainActivity 以外的 activity
                        if GoToStateName in self.m_ListVisitedState:
                            continue
                        self.m_bstaticAutoMode = True
                        res = self.StartNavigation(self.m_CurrentDisplayActivity, GoToStateName)
                        if res == -1: # Not found path
                            self.m_StaticAuto.recoverTracedState()
                            continue
                        while(self.m_iMode != MODETYPE.MANUAL): # wait for Navigation finish
                            pass
                        while(self.m_bstaticAutoMode):
                            pass
                        self.StartAutoMode()
                        while(self.m_iMode != MODETYPE.MANUAL): # wait for auto finish
                            pass
                        SendMessage = struct.pack(">BI",17, len(GoToStateName)) # [YuHeng]: 目的校正 tester.java 的 state，因為 tester.java 在經過一次的 auto mode 之後 array list 可能跑掉
                        SendMessage += GoToStateName.encode()
                        self.m_ClientSocket.send(SendMessage)
                        time.sleep(0.1)
                else: # [YuHeng]: 如果導航模式的 record 沒有東西的話則會先跑一次自動模式
                    if len(self.m_StaticAuto.inPathStateName) > 0:
                        self.m_bstaticAutoMode = True
                        self.StartAutoMode()
                        while(self.m_iMode != MODETYPE.MANUAL): # wait for auto finish
                            pass
                        self.m_bstaticAutoMode = False      
    def StartStaticAuto(self):
        if self.m_StaticAuto != None:
            self.m_StaticAuto.thread = threading.Thread(target = self.doStaticAuto)
            self.m_StaticAuto.thread.start()
            return 0
        else:
            return -1
                            
        print(self.m_StaticAuto.unTracedStateName)
    
    # [YuHeng]: for targeted orientation auto mode
    def StartTargetedAutoMode(self):
        if self.m_TargetedAuto != None:
            self.SetCurrentMode(MODETYPE.TAUTO)
            self.m_TargetedAutoStartTime = time.time()
            self.m_TargetedAuto.thread = threading.Thread(target = self.doTargetedAuto)
            self.m_TargetedAuto.threadTimer = threading.Thread(target = self.doTargetedAutoRecordTimer)
            self.m_TargetedAuto.thread.start()
            self.m_TargetedAuto.threadTimer.start()
            return 0
        else:
            return -1
    # [YuHeng]: for targeted orientation auto mode
    def doTargetedAuto(self):
        self.m_TAutoActivityVisitCountAndTime = {}
        # [YuHeng]: reset all stateButtonEvent
        # self.m_DicStateButtonEvent = {}
        # [YuHeng]: reset Visited Activity
        self.m_ListVisitedState = []
        self.StartAutoMode()
        while(self.m_iMode != MODETYPE.MANUAL): # wait for auto finish
            pass
        SendMessage = struct.pack(">BI",17, len(self.m_CurrentDisplayActivity))
        SendMessage += self.m_CurrentDisplayActivity.encode()
        self.m_ClientSocket.send(SendMessage)
        time.sleep(0.1)
        print("[YuHeng]: self.m_ListVisitedState: {}".format(self.m_ListVisitedState))
        # [YuHeng]: set all visited activities currently
        self.m_TargetedAuto.setCurrentVisitedState(self.m_ListVisitedState)
        # [YuHeng]: create unvisited state list
        self.m_TargetedAuto.unVisitedState()
        print("[TATUO Execution Msg]: unVisitedState() done!")
        print("[YuHeng]: show unvisitedActivities: {}".format(self.m_TargetedAuto.ListUnVisitedState))

        if(self.m_ActivityScanner != None):
            if(self.m_ActivityScanner.ListCannotOpenedActivities):
                self.m_TargetedAuto.ListCannotOpenedActivities = copy.deepcopy(self.m_ActivityScanner.ListCannotOpenedActivities)
        print("[TATUO Execution Msg]: Copy can not be opened activities list from Activity Scanner")
        
        # [YuHeng]: Explicit intent
        if(self.m_RuntimeException_lock == False):
            if(self.m_TargetedAuto.ListUnVisitedState):
                for unVisitedstate in self.m_TargetedAuto.ListUnVisitedState:
                    if((unVisitedstate not in self.m_ListVisitedState) and \
                       (unVisitedstate not in self.m_TargetedAuto.ListCannotOpenedActivities)):
                        self.m_jumpTargetActivityName = unVisitedstate
                        self.m_ActivityNameDiffFlag = False
                        unVisitedstate = unVisitedstate.replace('/', '.')[1:-1]
                        print("[Execution Msg]: {}".format(unVisitedstate))
                        self.jumpToTargetActivity(unVisitedstate, 0)
                        while(self.m_iMode != MODETYPE.TAUTO): # wait for case 18 finish
                            pass
                        if(self.m_RuntimeException_lock == True):
                            print("[-] Target auto break!")
                            break
                        if(self.m_problemActivityFlag == True):
                            self.InitJumpValueAfterCrashEvent()
                            # self.m_problemActivityFlag = False
                            continue
                        time.sleep(1.2)
                        print("[Current Display Activity]: {}".format(self.m_CurrentDisplayActivity))
                        print("[CurrentState]: {}".format(self.m_CurrentState.m_strName))
                        SendMessage = struct.pack(">BI",17, len(self.m_CurrentDisplayActivity))
                        SendMessage += self.m_CurrentDisplayActivity.encode()
                        self.m_ClientSocket.send(SendMessage)
                        time.sleep(0.1)
                        # [YuHeng]: 有些 activity 沒有 onResume，不會停留在目標頁面，或是 current_state 沒有與 m_CurrentDisplayActivity 對齊
                        if self.m_CurrentDisplayActivity != None:
                            print(self.m_CurrentDisplayActivity)
                            print(self.m_jumpTargetActivityName)
                            if self.m_CurrentDisplayActivity != self.m_jumpTargetActivityName or self.m_CurrentState != None:
                                if self.m_CurrentState.m_strName != self.m_jumpTargetActivityName:
                                    continue
                                continue
                        # time.sleep(0.8)
                        self.StartAutoMode()
                        while(self.m_iMode != MODETYPE.MANUAL): # wait for auto finish
                            pass
        print("[+] Target oriented auto testing Finish!")
        print("[+] Target oriented auto testing execution time: {}".format(time.time()-self.m_TargetedAutoStartTime))
        for k, v in self.m_TAutoActivityVisitCountAndTime.items():
            print("Time: {}, Activity Name: {}".format(k, v))
        self.SetCurrentMode(MODETYPE.MANUAL)
    # [YuHeng]: Activity Scanner record timer
    def doTargetedAutoRecordTimer(self):
        self.m_TargetedAuto.DictTimeandVisitCount = {'Time':[], 'Count':[]}
        tempCount = 0
        ListvisitedStateBeforeStart = self.m_ListVisitedState
        while True:
            if self.m_TargetedAuto.thread.is_alive():
                tempCount = len(list(self.m_TAutoActivityVisitCountAndTime.values()))
                for visitAct in ListvisitedStateBeforeStart:
                    if visitAct not in self.m_TAutoActivityVisitCountAndTime.values():
                        tempCount += 1
                self.m_TargetedAuto.DictTimeandVisitCount['Time'].append(time.time()-self.m_TargetedAutoStartTime)
                self.m_TargetedAuto.DictTimeandVisitCount['Count'].append(tempCount)
            else:
                break
            time.sleep(2)
        if not self.m_TargetedAuto.thread.is_alive():
            self.m_TargetedAuto.thread = None
        print("[YuHeng]: TAUTO Timer is done!")
        print("[YuHeng]: number of m_ListVisitedState: {}. List content: {}".format(len(self.m_ListVisitedState), self.m_ListVisitedState))
        print("--------------------")
        for k, v in self.m_TargetedAuto.DictTimeandVisitCount.items():
            print("{}: {},".format(k, v))
        print("Check detail name of visited activities:")
        for k , v in self.m_TAutoActivityVisitCountAndTime.items():
            print("{}: {},".format(k, v))
    # [YuHeng]: 向 Tester.java 傳送指令 18，執行直接跳轉的動作
    def jumpToTargetActivity(self, unVisitedstate, intent_mode):
        self.SetCurrentMode(MODETYPE.TJUMP)
        if(self.m_iMode == MODETYPE.TJUMP):
            self.m_bHaveChangeState = False
            SendMessage = struct.pack(">BII",18, len(unVisitedstate), intent_mode)
            SendMessage += unVisitedstate.encode()
            self.m_ClientSocket.send(SendMessage)
    # [YuHeng]: for new_navigation_handler mode
    def jumpFunction(self, data):
        if self.m_TargetedAuto != None:
            if self.m_TargetedAuto.DictImplicitIntent:
                if data["jumpActName"] in self.m_TargetedAuto.DictImplicitIntent.keys():
                    # [YuHeng]: if jumpActName is MainActivity, we have to add intent flag and set intent_mode = 2
                    if 'android.intent.action.MAIN' in self.m_TargetedAuto.DictImplicitIntent[data["jumpActName"]]:
                        actName = data["jumpActName"].replace('/', '.')[1:-1]
                        jump_mode = 2
                    # [YuHeng]: if we have to use implicit intent to jumpActName, we have to set intent_mode = 1
                    # elif self.m_TargetedAuto.DictImplicitIntent[data["jumpActName"]]:
                    #     print("[+] jump Function data value 1: ", data["jumpActName"])
                    #     actName = self.m_TargetedAuto.DictImplicitIntent[data["jumpActName"]][0]['action']
                    #     if 'data' in self.m_TargetedAuto.DictImplicitIntent[data["jumpActName"]][0].keys():
                    #         str_data = self.m_TargetedAuto.DictImplicitIntent[data["jumpActName"]][0]['data']
                    #         actName += '; ' + str_data
                    #     jump_mode = 1
                    # [YuHeng]: if we have to use explicit intent to jumpActName, we have to set intent_mode = 1
                    else:
                        print("[+] jump Function data value 2: ", data["jumpActName"])
                        actName = data["jumpActName"].replace('/', '.')[1:-1]
                        jump_mode = 0
                    # [YuHeng]: 紀錄 jump 的 target Activity name
                    # [*] 還沒處理 implicit intent 的部分
                    self.m_jumpTargetActivityName = data["jumpActName"]
                    self.m_ActivityNameDiffFlag = False
                    self.jumpToTargetActivity(actName, jump_mode)
                    while(self.m_iMode != MODETYPE.MANUAL): # wait for case 18 finish
                        pass
                    self.m_jumpTargetActivityName = None
                    return True
        return False
    # [YuHeng]: for Activity scanner mode
    def StartActivityScannerMode(self):
        if self.m_ActivityScanner != None:
            self.SetCurrentMode(MODETYPE.ASCAN)
            self.m_ActivityScannerStartTime = time.time()
            self.m_ActivityScanner.thread = threading.Thread(target = self.doActivityScanning)
            self.m_ActivityScanner.threadTimer = threading.Thread(target= self.doActivityScanningRecordTimer)
            self.m_ActivityScanner.thread.start()
            self.m_ActivityScanner.threadTimer.start()
            # print("[+] Activity Scanner execution time: {}".format(time.time()-self.m_ActivityScannerStartTime))
            return 0
        else:
            return -1
    def doActivityScanning(self):
        self.m_TAutoActivityVisitCountAndTime = {}
        # [YuHeng]: eliminate Activities which can not be opened successfully
        # self.problemActivitiesName 是 Tester.java 回傳回來的 Activity name
         # [YuHeng]: set all visited activities currently
        self.m_ActivityScanner.setCurrentVisitedState(self.m_ListVisitedState)
        # [YuHeng]: create unvisited state list
        self.m_ActivityScanner.unVisitedState()
        print("[Execution Msg]: unVisitedState() done!")

        # [YuHeng]: Explicit intent
        if(self.m_RuntimeException_lock == False):
            if(self.m_ActivityScanner.ListUnVisitedState):
                for unVisitedstate in self.m_ActivityScanner.ListUnVisitedState:
                    if((unVisitedstate not in self.m_ListVisitedState) and (unVisitedstate not in self.m_ActivityScanner.ListCannotOpenedActivities)):
                        self.m_jumpTargetActivityName = unVisitedstate
                        self.m_ActivityNameDiffFlag = False
                        unVisitedstate = unVisitedstate.replace('/', '.')[1:-1]
                        print("[Execution Msg]: {}".format(unVisitedstate))
                        self.jumpToTargetActivity(unVisitedstate, 0)
                        while(self.m_iMode != MODETYPE.ASCAN): # wait for case 18 finish
                            pass
                        if(self.m_RuntimeException_lock == True):
                            print("[-] 1 Activity Scanning break!")
                            break
                        if(self.m_problemActivityFlag == True):
                            self.m_problemActivityFlag = False
                        time.sleep(0.8)
                        print("[Current Display Activity]: {}".format(self.m_CurrentDisplayActivity))
                        SendMessage = struct.pack(">BI",17, len(self.m_CurrentDisplayActivity))
                        SendMessage += self.m_CurrentDisplayActivity.encode()
                        self.m_ClientSocket.send(SendMessage)
                        time.sleep(0.1)

        self.m_ActivityScanner.dividedImplicitIntent()
        # [YuHeng]: implicit intent
        if(self.m_RuntimeException_lock == False):
            if(self.m_ActivityScanner.ListUnVisitedStateImplicitIntent):
                for unVisitedstateByImplicit in self.m_ActivityScanner.ListUnVisitedStateImplicitIntent:
                    if((unVisitedstateByImplicit not in self.m_ListVisitedState) and (unVisitedstateByImplicit not in self.m_ActivityScanner.ListCannotOpenedActivities)):
                        # [YuHeng]: 先暫時選一個就好 有其他問題的話再來精進
                        # [YuHeng]: 組合 implicit intent 需要的參數
                        strimplicitIntentStatement = self.m_ActivityScanner.DictImplicitIntent[unVisitedstateByImplicit][0]['action']
                        if 'data' in self.m_ActivityScanner.DictImplicitIntent[unVisitedstateByImplicit][0].keys():
                            strimplicitInentDataStatement = self.m_ActivityScanner.DictImplicitIntent[unVisitedstateByImplicit][0]['data']
                            strimplicitIntentStatement += '; ' + strimplicitInentDataStatement
                        # strimplicitIntentActionStatement = self.m_ActivityScanner.DictImplicitIntent[unVisitedstateByImplicit][0]['action']
                        print("[Execution Msg]: implicit intent state => {}, {}".format(unVisitedstateByImplicit, strimplicitIntentStatement))
                        self.jumpToTargetActivity(strimplicitIntentStatement, 1)
                        while(self.m_iMode != MODETYPE.ASCAN): # wait for case 18 finish
                            pass
                        if(self.m_RuntimeException_lock == True):
                            print("[-] 2 Activity Scanning break!")
                            break
                        time.sleep(0.8)
                        print("[Current Display Activity]: {}".format(self.m_CurrentDisplayActivity))
                        SendMessage = struct.pack(">BI",17, len(self.m_CurrentDisplayActivity))
                        SendMessage += self.m_CurrentDisplayActivity.encode()
                        self.m_ClientSocket.send(SendMessage)
                        
        print("[+] Activity Scanning Finish!")
        print("[+] Activity Scanner execution time: {}".format(time.time()-self.m_ActivityScannerStartTime))
        self.SetCurrentMode(MODETYPE.MANUAL)
    # [YuHeng]: Activity Scanner record timer
    def doActivityScanningRecordTimer(self):
        self.m_ActivityScanner.DictTimeandVisitCount = {'Time':[], 'Count':[]}
        tempCount = 0
        ListvisitedStateBeforeStart = self.m_ListVisitedState
        while True:
            if self.m_ActivityScanner.thread.is_alive():
                tempCount = len(list(self.m_TAutoActivityVisitCountAndTime.values()))
                for visitAct in ListvisitedStateBeforeStart:
                    if visitAct not in self.m_TAutoActivityVisitCountAndTime.values():
                        tempCount += 1
                self.m_ActivityScanner.DictTimeandVisitCount['Time'].append(time.time()-self.m_ActivityScannerStartTime)
                self.m_ActivityScanner.DictTimeandVisitCount['Count'].append(tempCount)
            else:
                break
            time.sleep(1)
        if not self.m_ActivityScanner.thread.is_alive():
            self.m_ActivityScanner.thread = None
        print("[YuHeng]: ActivityScanner Timer is done!")
        print("[YuHeng]: number of m_ListVisitedState: {}. List content: {}".format(len(self.m_ListVisitedState), self.m_ListVisitedState))
        print("--------------------")
        for k, v in self.m_ActivityScanner.DictTimeandVisitCount.items():
            print("{}: {}".format(k, v))
        self.m_DicStateButtonEvent = {}

        print("Check detail name of visited activities:")
        for k , v in self.m_TAutoActivityVisitCountAndTime.items():
            print("{}: {},".format(k, v))

    # [YuHeng]: test Activity scanner
    def Exception_Record(self, _Input):
        self.m_print("\nException_Record")
        self.m_RuntimeException_lock = True
        # decode data
        exception_msg_length = struct.unpack(">I",_Input[:4])[0]
        _Input = _Input[4:]
        exception_msg = struct.unpack("{0}s".format(exception_msg_length),_Input[:exception_msg_length])[0].decode()
        
        # parsing data
        if(exception_msg != ""):
            # [YuHeng]: 有成功跳轉啟動 onCreate()，但因為某些因素無法啟動
            pattern = r'Unable to start activity ComponentInfo\{[^\}]*\}'
            _match = re.search(pattern, exception_msg)
            if _match:
                print("RuntimeException Msg: ", exception_msg[_match.start():_match.end()])
                sub_pattern = r'\{[^\}]*\}'
                new_msg = exception_msg[_match.start():_match.end()]
                _match2 = re.search(sub_pattern, new_msg)
                if _match2:
                    print("Ouccer RuntimeException place: ", new_msg[_match2.start():_match2.end()])
                    # get package name and Activity name
                    packageName_ActivityName = new_msg[_match2.start():_match2.end()][1:-1].split('/')
                    _packageName = packageName_ActivityName[0]
                    _ActivityName = packageName_ActivityName[1]
                    # check package name == self.m_Packname
                    if(_packageName == self.m_Packname):
                        _ActivityName = 'L' + _ActivityName.replace('.', '/') + ';'
                        self.m_problemActivityName = _ActivityName
                    # finish application
                    os.system(f"adb -s {SETTING.DEVICEID} shell am force-stop {self.m_Packname}")
                else:
                    print("Not find")
            else:
                # [YuHeng]: implicit intent 無法成功啟動 activity
                _implicit_intent_Exception_pattern = r"android.content.ActivityNotFoundException: No Activity found to handle Intent \{[^\}]*\}"
                _implicit_intent_Exception_match = re.search(_implicit_intent_Exception_pattern, exception_msg)
                if _implicit_intent_Exception_match:
                    print("Implicit intent Exception Msg: ", exception_msg[_implicit_intent_Exception_match.start():_implicit_intent_Exception_match.end()])
                    _sub_implicit_intent_Exception_pattern = r'\{[^\}]*\}'
                    _str_implicit_intent_action = exception_msg[_implicit_intent_Exception_match.start():_implicit_intent_Exception_match.end()]
                    _sub_implicit_intent_Exception_match = re.search(_sub_implicit_intent_Exception_pattern, _str_implicit_intent_action)
                    if _sub_implicit_intent_Exception_match:
                        _sub_str_implicit_intent_action = _str_implicit_intent_action[_sub_implicit_intent_Exception_match.start():_sub_implicit_intent_Exception_match.end()]
                        _sub_str_implicit_intent_action = _str_implicit_intent_action[1:-1].strip()
                        _sub_str_implicit_intent_Exception_pattern = r'='
                        final_match = re.search(_sub_str_implicit_intent_Exception_pattern, _sub_str_implicit_intent_action)
                        if final_match:
                            print(final_match.start())
                            print(final_match.end())
                            print(_sub_str_implicit_intent_action[final_match.end():])
                            _str_problem_action = _sub_str_implicit_intent_action[final_match.end():]
                            # [YuHeng]: Activity Scanner is working
                            if self.m_ActivityScanner.thread != None:
                                if self.m_ActivityScanner.thread.is_alive():
                                    # [YuHeng]: mapping intent action and Activity name
                                    for _act_name, _intent_filter in self.m_ActivityScanner.DictImplicitIntent.items():
                                        if _intent_filter:
                                            if 'action' in _intent_filter[0]:
                                                for _action in _intent_filter[0]['action']:
                                                    if _action == _str_problem_action:
                                                        self.m_problemActivityName = _act_name
                                                        if(self.m_iMode == MODETYPE.TJUMP):
                                                            # [YuHeng]: remove exception lock
                                                            self.m_RuntimeException_lock = False
                                                            self.SetCurrentMode(MODETYPE.ASCAN)
                            # [YuHeng]: Target Auto thread is working or Target jump Function
                            elif self.m_TargetedAuto != None:
                                for _act_name, _intent_filter in self.m_TargetedAuto.DictImplicitIntent.items():
                                    if _intent_filter:
                                        if 'action' in _intent_filter[0]:
                                            for _action in _intent_filter[0]['action']:
                                                if _action == _str_problem_action:
                                                    self.m_problemActivityName = _act_name
                                                    if(self.m_iMode == MODETYPE.TJUMP):
                                                        # [YuHeng]: remove exception lock
                                                        self.m_RuntimeException_lock = False
                                                        self.SetCurrentMode(MODETYPE.MANUAL)
                else:
                    print("Not find")
        if self.m_problemActivityName != None:
            self.m_problemActivityFlag = True
    def Load_Json_To_Self(self, json_data):
        JSON_STATE_list = []

        for state in json_data:
            stateName = state["state_name"]
            #print(f"-----------------load {stateName}")
            NewState = StateButtonEvent(stateName)
            ListView = []
            if( len(state["views_data"]) > 0 ):
                for tmpview in state["views_data"]:
                    appendView = View()
                    appendView.m_iID = tmpview["view_id"]
                    if( len(tmpview["view_data"]) > 0 ):
                        for tmpevent in tmpview["view_data"]:
                            appendEvent = ClickEvent()
                            appendEvent.parentViewID = appendView.m_iID
                            appendEvent.m_iType = tmpevent["click_type"]
                            if(tmpevent["nextState"] != None): # fulfill statename firt, will set real state later
                                appendEvent.m_NextState = tmpevent["nextState"]
                            else:
                                appendEvent.m_NextState = None
                            if( len(tmpevent["textView"]) > 0 ):
                                for tmptext in tmpevent["textView"]:
                                    appendEvent.addEditTextRecord( EditText(tmptext["text_view_id"], 
                                        tmptext["text_view_type"], 
                                        tmptext["text_view_content"], tmptext["text_view_vbname"]) )
                            appendView.Add_Extend_ClickEvent([appendEvent])
                    ListView.append(appendView)
            NewState.SetListView(ListView)
            JSON_STATE_list.append(NewState)

        for tmpstate in JSON_STATE_list:
            for tmpview in tmpstate.m_ListView:
                for tmpevent in tmpview.m_ListClickEvent:
                    if tmpevent.m_NextState != None:
                        for statee in JSON_STATE_list:
                            if tmpevent.m_NextState == statee.m_strName:
                                tmpevent.SetNextState(statee)
                                #print(f"{tmpstate.m_strName} add next {tmpevent.m_NextState.m_strName}")

        for state in JSON_STATE_list:
            if(state.m_strName not in self.m_DicStateButtonEvent):
                self.m_DicStateButtonEvent[state.m_strName] = state
            else:
                for tmpview in state.m_ListView:
                    self.m_DicStateButtonEvent[state.m_strName].add_extend_View(tmpview)                  
    def StartFuzzing(self, TextID):
        currentStateName = self.m_CurrentDisplayActivity
        print(f"currentStateName {currentStateName}")
        if currentStateName in self.m_DicStateButtonEvent:
            currState = self.m_DicStateButtonEvent[currentStateName]
            TargetTextEvent = currState.getTextViewEvent(TextID)
            if TargetTextEvent != None:
                self.SetCurrentMode(MODETYPE.FUZZING)
                self.m_FuzzHandler = Fuzzing_Handler(TextID, TargetTextEvent)
                action = self.m_FuzzHandler.Start(currentStateName)
                if action != None:
                    self.m_ClientSocket.send(action)
                else:
                    print("Finish")
                    self.SetCurrentMode(MODETYPE.MANUAL)
            else:
                self.m_FuzzHandler = None
                print("Not Found TextView")
                return False
        else:
            self.m_FuzzHandler = None
            print("Cannot locate Current State")
            return False
    def Event_FuzzDoNext(self, _input):
        from time import gmtime, strftime
        #print(strftime("%Y-%m-%d %H:%M:%S", gmtime()))
        if self.m_FuzzHandler != None:
            action = self.m_FuzzHandler.GetNextAction()
            if action != None:
                self.m_ClientSocket.send(action)
            else:
                print("Fuzzing Finish")
                self.SetCurrentMode(MODETYPE.MANUAL)
    def Set_IssueState(self, stateList, statePathList):
        if(stateList != [] and statePathList != []):
            self.m_StaticAuto = StaticAutoModule(stateList, statePathList)
            return 0
        return -1
    # [YuHeng]: set can be visited activities for targeted orientation auto mode
    def Set_TargetedAutoMode(self, can_visited_list, implicit_intent_dict):
        if(can_visited_list != []):
            self.m_TargetedAuto = TargetedAutoModule(can_visited_list, implicit_intent_dict)
            return 0
        return -1
    # [YuHeng]: test Activity Scanner
    def Set_ActivityScannerMode(self, all_visited_list, implicit_intent_dict):
        if(all_visited_list != []):
            self.m_ActivityScanner = TargetedAutoModule(all_visited_list, implicit_intent_dict)
            return 0
        return -1
    def Send_SetAcntPwd(self, s_account, s_password, s_text):
        self.m_s_account = s_account
        self.m_s_password = s_password
        self.m_s_text = s_text
        if (self.m_ClientSocket != None):
            SendMessage = struct.pack(">BI",16,len(s_account))
            SendMessage += s_account.encode()
            SendMessage += struct.pack(">I",len(s_password))
            SendMessage += s_password.encode()
            SendMessage += struct.pack(">I",len(s_text))
            SendMessage += s_text.encode()
            self.m_ClientSocket.send(SendMessage)                  
    def StartNavigation(self, currentStateName, toStateName):
        if(self.m_NavHandler != None):
            self.SetCurrentMode(MODETYPE.NAVIGATION)
            print()
            action = self.m_NavHandler.Start(currentStateName, toStateName)
            if action != None:
                #print("SendAction !!!!!!!")
                self.m_ClientSocket.send(action)
                return 0
            else:
                self.m_print(f"Cannot Find the path form: {currentStateName} to: {toStateName} ")
                self.SetCurrentMode(MODETYPE.MANUAL)
                return -1
    def RunCmdFromUser(self, action, data=None, socket=None):
        #self.m_print("Stdin thread start!!")
        self.m_websocket = socket
        self.m_print("|"+action + "|")
        if(action == "exit"):
            #self.m_print("Exit!!!!!")
            self.KillSelf()
        elif(action == "auto"):
            if self.m_CurrentState != None:
                self.StartAutoMode()
                return 0
            else:
                return -1
        elif(action == "manual"):
            #self.m_print("Change Manual")
            self.m_ClientSocket.send(struct.pack(">I",0))
            self.SetCurrentMode(MODETYPE.MANUAL)
        elif(action == "back"):
            self.SendPressBackButtonEvent()
        elif(action == "next"):
            #self.m_print("Next Step")
            #m_Modeself.m_ClientSocket.send(struct.pack(">I",0))
            m_NextStep = True
        elif(action == "loadjson"): # load from pre store json
            with open(f"app_record/{self.m_Packname}.json") as f:
                data = json.load(f)
            self.Load_Json_To_Self(data)
            if(self.m_NavHandler != None):
                self.m_NavHandler.add_record(data)
            else:
                self.m_NavHandler = Navigation_Handler(record(data))
            return self.m_NavHandler.Get_AllTostate()
        elif(action == "loadcurr"): #load current record
            data = json.loads(self.Load_current_record())
            if(self.m_NavHandler != None):
                self.m_NavHandler.add_record(data)
            else:
                self.m_NavHandler = Navigation_Handler(record(data))
            return self.m_NavHandler.Get_AllTostate()
        elif(action == "save_record"):
            try:
                data = self.Load_current_record()
                with open(f"app_record/{self.m_Packname}.json", "w") as f:
                    f.write(data)
                return True
            except IOError as e:
                return False
        elif(action == "goto"):
            if(self.m_NavHandler != None and data != None):
                if("toState" in data):
                    GoToStateName = data["toState"]
                    self.StartNavigation(self.m_CurrentDisplayActivity, GoToStateName)
        elif(action == "showall"):
            json_state = []
            for i in list(self.m_DicStateButtonEvent.values()):
                print(f"State: {i.m_strName}")
                json_state.append(i.list_all_Record(i.m_strName))
            print(json.dumps(json_state))
        elif(action == "fuzz"):
            if(self.m_CurrentState != None):
                FuzzID = data["FuzzID"]
                try:
                    _ID = int(FuzzID)
                    if _ID > 0:
                        self.StartFuzzing(_ID)
                except ValueError:
                    m_print("Text ID Error!")
            else:
                m_print("Load record first or no Current state")
        elif(action == "setpa"):
            if("setacc" in data and "setpass" in data):
                tmp_account = data["setacc"]
                tmp_password = data["setpass"]
                tmp_text = data["settext"]
                self.Send_SetAcntPwd(tmp_account, tmp_password, tmp_text)
                return True
            return False
        elif(action == "sauto"):
            self.StartStaticAuto()
        # [YuHeng]: for targeted orientation auto mode
        elif(action == "tauto"):
            # [YuHeng]: After full auto, start targeted orientation exploration
            print("[Execution Msg]: StartTargetedAutoMode!")
            self.StartTargetedAutoMode()
        elif(action == "jump"):
            print("Jump to {}".format(data["jumpActName"]))
            res = self.jumpFunction(data)
            if res:
                return True
            else:
                return False
        # [YuHeng]: test Activity scanner
        elif(action == "ascan"):
            print("Set Activity Scanner start!")
            self.StartActivityScannerMode()
            

    def KillSelf(self):
        if CMDDEBUG:
            if(os.name == 'nt'):
                os.system('powershell -c kill {}'.format(os.getpid()))
            else:
                os.system('bash -c "kill {}"'.format(os.getpid()))
        else:
            if self.NewControlThread.is_alive():
                self.SetCurrentMode(MODETYPE.EXIT)
                if(self.m_ClientSocket != None):
                    self.m_ClientSocket.shutdown(socket.SHUT_WR)
                    self.m_ClientSocket.close()
                #self.NewControlThread.join()
    # [halloworld]: In AutoMode it will get new click event 
    def UpdateNewState(self,StateName,_Input):
        self.m_print("\nUpdateNewState")
        if(StateName == "null"):
            NewState = StateButtonEvent(StateName)
            NewListView = self.GetListView(_Input)
            NewState.SetListView(NewListView)
            TryFindState = self.FindSameUnknownState(NewState)
            if(TryFindState == None):
                #self.m_print('It is new null state')
                StateName = "Unknown_{}".format(len(self.m_ListUnknownState))
                NewState.m_strName = StateName
                self.m_ListUnknownState.append(NewState)
                self.m_DicStateButtonEvent[StateName] = NewState
                print("[YuHeng]: UpdateNewState unKnownstate: {}".format(StateName))
                SendMessage = struct.pack(">BI",13,len(StateName))
                SendMessage += StateName.encode()
                #self.m_print("Send Exec command Case 13 (will return 0 FINISH ACTION) in UpdateNewState")
                self.m_ClientSocket.send(SendMessage)
                Recvmsg = self.m_ClientSocket.recv(4)
                iLength = struct.unpack(">I",Recvmsg[:4])[0]
                Recvmsg = self.m_ClientSocket.recv(iLength)
            else:
                StateName = TryFindState.m_strName

        elif(StateName not in self.m_DicStateButtonEvent):
            NewState = StateButtonEvent(StateName)
            self.m_DicStateButtonEvent[StateName] = NewState
            NewListView = self.GetListView(_Input)
            NewState.SetListView(NewListView)
        elif self.m_DicStateButtonEvent[StateName].m_Signature == "":  #if this Event has been created by Event_ViewClicked before
            NewListView = self.GetListView(_Input)
            self.m_DicStateButtonEvent[StateName].SetListView(NewListView)
            #NewState.m_ParentState = self.m_CurrentState
        #self.m_print('Change State : ' + StateName)
        NewState = self.m_DicStateButtonEvent[StateName]
        if(self.m_FirstState == None):
            self.m_FirstState = NewState
        if(self.m_CurrentState != None):
            CurrentClickEvent = self.m_CurrentState.GetCurrentEvent()
            if(CurrentClickEvent != None):
                CurrentClickEvent.SetNextState(NewState)
        self.m_CurrentState = NewState  
    # 記錄當前頁面的所有 click event          
    def Event_ChangeState(self,_Input):
        self.m_print('\nEvent_ChangeState')
        #print(datetime.now().time())
        # Get State Name
        self.m_bIsResume = False
        StateName_Length = struct.unpack(">I",_Input[:4])[0]
        _Input = _Input[4:]
        StateName = struct.unpack("{0}s".format(StateName_Length),_Input[:StateName_Length])[0].decode()
        

        bIsActivity = False
        if(StateName.find(',Activity') != -1):
            bIsActivity = True
            StateName = StateName.replace(',Activity','')
            # [YuHeng]: record TATUO activity visit count and time data
            if self.m_TargetedAuto != None:
                if self.m_TargetedAuto.thread != None:
                    if self.m_TargetedAuto.thread.is_alive():
                        if StateName not in list(self.m_TAutoActivityVisitCountAndTime.values()):
                            lapTime = time.time() - self.m_TargetedAutoStartTime
                            self.m_TAutoActivityVisitCountAndTime[lapTime] = StateName
            # [YuHeng]: record ASCAN activity visit count and time data
            if self.m_ActivityScanner != None:
                if self.m_ActivityScanner.thread != None:
                    if self.m_ActivityScanner.thread.is_alive():
                        if StateName not in list(self.m_TAutoActivityVisitCountAndTime.values()):
                            lapTime = time.time() - self.m_ActivityScannerStartTime
                            self.m_TAutoActivityVisitCountAndTime[lapTime] = StateName
        if(self.m_CurrentState != None):
            self.m_print('Current State : ' + self.m_CurrentState.m_strName)
        self.m_print('Change State : ' + StateName +  ", " + str(self.m_iMode))

        # [YuHeng]: test
        if(StateName in self.m_DicStateButtonEvent):
            print("m_DicStateButtonEvent: ",self.m_DicStateButtonEvent[StateName].m_strName)
        else:
            print("[-] {} not in m_DicStateButtonEvent.".format(StateName))
        _Input = _Input[StateName_Length:]
        #CurrentClickEvent = self.m_CurrentState.GetCurrentEvent()
        # It is known state in history
        if(self.m_bHaveChangeState):
            print("NOOOOOOOO CHANGSTATE")
            self.m_bHaveChangeState = False
            return
        NewState = None
        if (self.m_iMode == MODETYPE.MANUAL) or \
            (self.m_iMode == MODETYPE.NAVIGATION) or \
            (self.m_iMode == MODETYPE.TJUMP) or\
            (self.m_iMode == MODETYPE.TAUTO) or\
            (self.m_iMode == MODETYPE.ASCAN): # notice
            
            # [YuHeng]: for targeted oriented jump mode
            # if(self.m_iMode == MODETYPE.TAUTO):
            #     self.m_RetrunCurrentActivity = StateName
            if(StateName not in self.m_DicStateButtonEvent):
                NewState = StateButtonEvent(StateName)
                self.m_DicStateButtonEvent[StateName] = NewState
                NewListView = self.GetListView(_Input)
                NewState.SetListView(NewListView)
            else: #if this Event has been created by Event_ViewClicked before
                NewListView = self.GetListView(_Input)
                self.m_DicStateButtonEvent[StateName].SetListView(NewListView)
            
            if(self.m_iMode == MODETYPE.NAVIGATION):
                self.m_NavHandler.Event_ChangeState(self.m_CurrentState.m_strName)
            elif(self.m_iMode == MODETYPE.MANUAL) or (self.m_iMode == MODETYPE.TJUMP) or\
                (self.m_iMode == MODETYPE.TAUTO):
            # elif(self.m_iMode == MODETYPE.MANUAL):
                if(self.m_CurrentState != None):
                    Current_event = self.m_CurrentState.GetCurrentEvent()
                    if(Current_event != None):
                        Current_event.SetNextState(self.m_DicStateButtonEvent[StateName])
            # [YuHeng]: 如果是上一個 activity 的資料的話，則把 currentState 改成 resumeState
            # print("Check m_DicStateButtonEvent: {}".format(StateName not in self.m_DicStateButtonEvent))
            # if((StateName not in self.m_DicStateButtonEvent) or (self.m_CurrentState==None)):
            #     print("[StateName]: {}".format(StateName))
            #     self.m_CurrentState = self.m_DicStateButtonEvent[StateName]
            # else:
            #     if(self.m_ResumeState!=None):
            #         print("[resumeState]: {}".format(self.m_ResumeState.m_strName))
            #         self.m_CurrentState = self.m_ResumeState
            #         self.m_ResumeState = None
            #     else:
            #         print("[no ResumeState StateName]: {}".format(StateName))
            #         self.m_CurrentState = self.m_DicStateButtonEvent[StateName]
            self.m_CurrentState = self.m_DicStateButtonEvent[StateName]
            print(f"ChangeSTATE::     self.m_CurrentState {self.m_CurrentState.m_strName}")
        elif(self.m_CurrentState == None or self.m_CurrentState.GetCurrentEvent().GetNextState() == None or StateName not in self.m_DicStateButtonEvent):
        # elif(self.m_CurrentState == None or self.m_CurrentState.GetCurrentEvent() == None or StateName not in self.m_DicStateButtonEvent):
            #self.m_print('New State') #auto Mode
            print("[CurrentState]: {}".format(self.m_CurrentState.m_strName))
            self.UpdateNewState(StateName,_Input) # [YuHeng]: 自動模式下使用 UpdateNewState 來處理接收到的 click event
        else:
            #self.m_print('Old State')
            self.m_CurrentState = self.m_CurrentState.GetCurrentEvent().GetNextState()
        if(StateName == 'MainActivity'):
            self.m_print('Is Main')
            #self.m_CurrentState.m_iIndex = 35
        if(bIsActivity == True):
            if(self.m_CurrentState != None):
                self.m_ActivityBefore = self.m_ActivityNow
                self.m_ActivityNow = self.m_CurrentState
                self.m_CurrentState.m_bIsActivity = bIsActivity
        if(self.m_iMode == MODETYPE.AUTO):
            self.m_bHaveChangeState = True
        # [YuHeng]: test
        print("[*] Check new State: {}".format(StateName))
        print("Change State m_bHaveChangeState {}".format(self.m_bHaveChangeState))
        self.m_ListTraceState.append(self.m_CurrentState)
        self.m_iCurrentDepth += 1
        
        #self.m_print('!!!!!!!!!!!!!!!!!!Change State : ' + StateName)
    def FindSameUnknownState(self,_State):
        ReturnValue = None
        iListCount = len(self.m_ListUnknownState)
        for i in range(iListCount):
            TraceState = self.m_ListUnknownState[i]
            if(TraceState.m_Signature == _State.m_Signature):
                ReturnValue = TraceState
                break
                
        
                
        return ReturnValue
    def CheckStateInHistory(self,_State):
        ReturnValue = False
        iListCount = len(self.m_ListTraceState) - 1
        '''if(_State.m_strName == "null"):
            for i in range(iListCount):
                TraceState = self.m_ListTraceState[i]
                if(self.CheckSameState(_State,TraceState)):
                    ReturnValue = True
                    break
        else:'''
        #self.m_print('List Count : ' + str(len(self.m_ListTraceState)))
        for i in range(iListCount):
            TraceState = self.m_ListTraceState[i]
            #self.m_print('Source Name : {}, Target Name : {}'.format( _State.m_strName,TraceState.m_strName))
            if(_State.m_strName == TraceState.m_strName):
                #self.m_print('Find : ' + TraceState.m_strName)
                ReturnValue = True
                break
        
                
        return ReturnValue
    # Only For AutoMode
    def Event_FinishExecute(self,_Input):
        self.m_print("\nEvent_FinishExecute")
        if(self.m_bIsKnownState): # If we already know the current clickEvent's nextstate, then m_bIsKnownState will be true.
            self.m_bIsKnownState = False
            if(self.m_bHaveChangeState == False):
                self.m_print('Select Old State')
                self.m_CurrentState = self.m_CurrentState.GetCurrentEvent().GetNextState()
                self.m_ListTraceState.append(self.m_CurrentState)
                self.m_bHaveChangeState = True
                print("Event_FinishExecute m_bHaveChangeState True")
                SendMessage = struct.pack(">BI",11,len(self.m_CurrentState.m_strName)) # [YuHeng]: 傳送指令 11，Tester.java 會根據指令執行，最後回傳 12 SETSTATE_FINISH
                SendMessage += self.m_CurrentState.m_strName.encode()
                #self.m_print("Send Command Case 11 (return 12 SETSTATE_FINISH) in Event_FinishExecute")
                self.m_ClientSocket.send(SendMessage)
                Recvmsg = self.m_ClientSocket.recv(4)
                iLength = struct.unpack(">I",Recvmsg[:4])[0]
                Recvmsg = self.m_ClientSocket.recv(iLength)
                if(self.m_CurrentState.m_bIsActivity == True):
                    self.m_ActivityBefore = self.m_ActivityNow
                    self.m_ActivityNow = self.m_CurrentState

        if(self.m_bHaveChangeState):
            self.m_bHaveChangeState = False
            if (self.m_bstaticAutoMode):
                print("self.m_bstaticAutoMode True")
                if(self.m_CurrentState != None):
                    print(" 0Current State:", self.m_CurrentState.m_strName)
                    if self.m_CurrentState.m_strName not in self.m_StaticAuto.inPathStateName:
                        print(" 1 not in Current State:", self.m_CurrentState.m_strName)
                        self.m_bHavePressBack = True
                        self.m_bsautoModePressBack = True
                    if self.m_CurrentState.m_strName in self.m_StaticAuto.unTracedStateName:
                        print(" 2 in Current State:", self.m_CurrentState.m_strName)
                        self.m_StaticAuto.setStateTraced(self.m_CurrentState.m_strName)
        else:
            self.m_print('[Event_FinishExecute] No Change State Finish!!!!!!!!!!!')
            self.m_CurrentState.FinishEvent() # Will increase index by 1 for finish last event and then we can get new event by GetIndex
        #self.m_print('Finished Execute')
        #self.m_print('Name : ' + self.m_CurrentState.m_strName)
        # [GetIndex]
        iEventValue, iViewIndex, iItemIndex = self.m_CurrentState.GetIndex()
        self.m_print('select EventValue : {}, ViewIndex : {}, ItemIndex : {}'.format(iEventValue,iViewIndex,iItemIndex))
        if(self.m_CurrentState != None):
            self.m_print('Event_FinishExecute current State Name : ' + self.m_CurrentState.m_strName)
        if(self.m_iMode != MODETYPE.AUTO ): #notice
            if(self.m_bIsResume):
                self.m_CurrentState = self.m_ResumeState
                self.m_ActivityNow = self.m_ResumeState
                self.m_ActivityBefore = self.m_ResumeState
                self.m_bIsResume = False
                
        else:
            # m_bHavePressBack: 需要按返回
            if self.m_bHavePressBack:
                print("Event_FinishExecute m_bHavePressBack")
                self.SendPressBackButtonEvent()
            # onResume: 會再執行一次 Event_FinishExecute
            elif self.m_bIsResume:
                self.m_print('Event_FinishExecute Is Resume')
                self.m_bHaveChangeState = True
                print("Event_FinishExecute Resume m_bHaveChangeState True")
                self.m_bIsResume = False
                if(self.m_ResumeState != None):
                    print("[Event_FinishExecute] self.m_ResumeState != None")
                    if(self.m_CurrentState.HaveFinishAllEvent() == False):
                        self.m_CurrentState.FinishEvent()
                        print("[Event_FinishExecute] Finish current event")
                        if(self.m_CurrentState.HaveFinishAllEvent() or self.m_bsautoModePressBack):
                            print("[Event_FinishExecute] This State Finish Traced")
                            self.m_bsautoModePressBack = False
                            self.m_CurrentState.m_bHaveTraced = True
                            self.RemoveRecursively()
                            if (self.m_iMode == MODETYPE.EXIT or self.m_iMode == MODETYPE.MANUAL):
                                return
                    self.m_CurrentState = self.m_ResumeState
                    self.m_ActivityNow = self.m_ResumeState
                    self.UpdateListHistory()
                    if(self.m_bsautoModePressBack):
                        self.m_bsautoModePressBack = False
                        self.m_CurrentState.FinishEvent()
                    self.m_DicEventHandler[OPCODETYPE.FINISHACTION](None)
                else:
                    self.SendPressBackButtonEvent()
            # m_bHaveTraced: 此 State 是否分析過
            elif (self.m_CurrentState.m_bHaveTraced or 
                  self.CheckStateInHistory(self.m_CurrentState)):
                # traced
                print("Event_FinishExecute traced")
                self.m_bHaveChangeState = True
                NewState = self.m_CurrentState
                if len(self.m_ListTraceState) > 1: 
                    self.m_ListTraceState.pop()
                    self.m_CurrentState = self.m_ListTraceState[-1]
                    self.m_CurrentState.FinishEvent()
                if(self.m_CurrentState.HaveFinishAllEvent()):
                    print("Event_FinishExecute HaveFinishAllEvent")
                    self.m_CurrentState.m_bHaveTraced = True
                    self.RemoveRecursively()
                    if (self.m_iMode == MODETYPE.EXIT or self.m_iMode == MODETYPE.MANUAL):
                        return
                if(NewState.m_bIsActivity):
                    self.m_print('Event_FinishExecute Traced Activity')
                    self.SendPressBackButtonEvent()
                else:
                    self.m_print('Event_FinishExecute Traced none Activity')
                    self.m_CurrentState = self.m_ActivityBefore
                    self.m_ActivityNow = self.m_CurrentState
                    SendMessage = struct.pack(">BI",11,len(self.m_CurrentState.m_strName))
                    SendMessage += self.m_CurrentState.m_strName.encode()
                    #self.m_print("Send Command 11 (will return SETSTATE_FINISH) in Event_FinishExecute Traced none Activity")
                    self.m_ClientSocket.send(SendMessage)
                    Recvmsg = self.m_ClientSocket.recv(4)
                    iLength = struct.unpack(">I",Recvmsg[:4])[0]
                    Recvmsg = self.m_ClientSocket.recv(iLength)
                    self.UpdateListHistory()
                    self.m_DicEventHandler[OPCODETYPE.FINISHACTION](None)
            # iViewIndex == -1: 分析完了
            elif(iViewIndex == -1 or self.m_iCurrentDepth > self.m_iMaxDepth):
                #This state trace over
                self.m_print('Event_FinishExecute This state trace over : ' + self.m_CurrentState.m_strName)
                self.m_bHaveChangeState = True
                print("Event_FinishExecute this state trace over m_bHaveChangeState True")
                self.m_CurrentState.m_bHaveTraced = True
                '''
                RemoveRecursively will update parent nextEvent since current state trace over 
                 and we will Pressback to parent state then if parent state not update will press
                 same button to current state. We need to use RemoveRecursively() to prevent that
                 happend.
                '''
                self.RemoveRecursively()
                if (self.m_iMode == MODETYPE.EXIT or self.m_iMode == MODETYPE.MANUAL):
                    return
                if(self.m_ActivityNow.HaveFinishAllEvent()):
                    self.SendPressBackButtonEvent()
                else:
                    self.m_CurrentState = self.m_ActivityNow
                    self.m_ActivityBefore = self.m_ActivityNow
                    SendMessage = struct.pack(">BI",11,len(self.m_CurrentState.m_strName))
                    SendMessage += self.m_CurrentState.m_strName.encode()
                    #self.m_print("Send Command 11 (will return SETSTATE_FINISH) in Event_FinishExecute trace over")
                    self.m_ClientSocket.send(SendMessage)
                    Recvmsg = self.m_ClientSocket.recv(4)
                    iLength = struct.unpack(">I",Recvmsg[:4])[0]
                    Recvmsg = self.m_ClientSocket.recv(iLength)
                    self.UpdateListHistory()
                    self.m_DicEventHandler[OPCODETYPE.FINISHACTION](None)
            else:
                #self.m_print('select EventValue : {}, ViewIndex : {}, ItemIndex : {}'.format(iEventValue,iViewIndex,iItemIndex))
                SendMessage = struct.pack(">Biii",4,iEventValue,iViewIndex,iItemIndex)
                #self.m_print('Select ' + str(iIndex))
                self.PrintHistory()
                self.m_print(f"Button Click EventValue: {iEventValue} iViewIndex: {iViewIndex} iItemIndex: {iItemIndex}")
                self.m_ClientSocket.send(SendMessage)
                
                if(self.m_CurrentState.GetCurrentEvent() != None):
                    if(self.m_CurrentState.GetCurrentEvent().GetNextState() != None):
                        self.m_bIsKnownState = True
                        self.m_bHaveChangeState = False
    def PrintListState(self):
        PrintString = "States : "
        for state in self.m_ListTraceState:
            PrintString += state.m_strName + ", "
        #self.m_print(PrintString)
    def PrintHistory(self):
        strPrint = 'History : '
        for TraceState in self.m_ListTraceState:
            strPrint += str(TraceState.m_iIndex) + ' '
        #self.m_print(strPrint)
    def RemoveRecursively(self):
        bReturnValue = True
        iListCount = len(self.m_ListTraceState)
        print(f"In RemoveRecursiv {iListCount}")
        for i in range(iListCount-1,-1,-1):
            TraceState = self.m_ListTraceState[i]
            print(f"RemoveRecursively TraceState: {TraceState.m_strName}")
            iEventValue,_,_ = TraceState.GetIndex()
            if(TraceState.m_bHaveTraced == False and iEventValue != -1):
                print(f"RemoveRecursively False")
                bReturnValue = False
                break
            else:
                #TraceState.m_bHaveTraced = True
                #self.m_print('Finished : ' + str(TraceState.m_strName))
                if(i > 0):
                    #First Node
                    print(f"RemoveRecursively Finish")
                    ParentState = self.m_ListTraceState[i-1]
                    ParentState.FinishEvent()
                    break
                else:
                    iTime = time.time() - self.m_StartTime #finish
                    self.m_print("Execute Time : " + str(iTime))
                    print(f"Visited Activity: {len(self.m_ListVisitedState)}\n")
                    #print(self.Load_current_record())
                    self.SetCurrentMode(MODETYPE.MANUAL)
                    #self.KillSelf()
                    
        return bReturnValue
    def ClearState(self):
        self.m_print('Clear State!!!!!!!!!!!')
        self.m_bHaveChangeState = True
        print("ClearState m_bHaveChangeState True")
        self.m_CurrentState.m_bHaveTraced = True
        bFinished = self.RemoveRecursively()
        if (self.m_iMode == MODETYPE.EXIT or self.m_iMode == MODETYPE.MANUAL):
            return
        #self.m_print('Here')
        self.FindNextStep()
        #self.m_bFinished = True
    def initAllState(self):
        for stname in self.m_DicStateButtonEvent:
            self.m_DicStateButtonEvent[stname].initAllIndex()       
    def FindNextStep(self):
        #iEventValue, iViewIndex, iItemIndex = self.m_ActivityNow.GetIndex()
        if(self.m_ActivityNow.m_bHaveTraced == True):
            #Press Back Button
            #if(self.m_bHavePressBack == False):
            #self.m_print('Press Back Activity : ' + self.m_ActivityNow.m_strName)
            #self.m_print('Index : {}, Total : {} '.format(self.m_ActivityNow.m_iIndex,self.m_ActivityNow.m_iTotalNumber))

            self.m_bHavePressBack = True
            #self.m_print('Press Back')
            self.SendPressBackButtonEvent()
        else:
            #self.m_print('Continue Find')
            self.m_CurrentState = self.m_ActivityNow
            SendMessage = struct.pack(">BI",11,len(self.m_CurrentState.m_strName))
            SendMessage += self.m_CurrentState.m_strName.encode()
            #self.m_print("Send Command 11 (will return SETSTATE_FINISH) in FindNextStep")
            self.m_ClientSocket.send(SendMessage)
            Recvmsg = self.m_ClientSocket.recv(4)
            iLength = struct.unpack(">I",Recvmsg[:4])[0]
            Recvmsg = self.m_ClientSocket.recv(iLength)
            self.UpdateListHistory()
            self.m_print('current name : ' + self.m_CurrentState.m_strName)
            self.m_bHaveChangeState = True
            print("FindNextStep m_bHaveChangeState true")
            self.m_DicEventHandler[OPCODETYPE.FINISHACTION](None)
    def SendPressBackButtonEvent(self):
        self.m_print('SendPressBackButtonEvent')
        SendMessage = struct.pack(">B",10)
        #input()
        self.m_bHavePressBack = True
        #self.m_print("Send Command 10 (will return finish action 1s) in SendPressBackButtonEvent")
        iLength = self.m_ClientSocket.send(SendMessage)
        
        #self.m_print("Send Length : " + str(iLength))
    def GetState(self):
        if self.m_CurrentDisplayActivity != None:
            if CMDDEBUG :
                self.m_print('Current State : ' + self.m_CurrentDisplayActivity)
                return None
            else: # for webapp.py use
                return self.m_CurrentDisplayActivity
    def GetAvaliableText(self):
        ReturnValue = []
        alltext = None
        if self.m_CurrentDisplayActivity != None:
            currentStateName = self.m_CurrentDisplayActivity
            if currentStateName in self.m_DicStateButtonEvent:
                alltext = self.m_DicStateButtonEvent[currentStateName].getAllText()
        if alltext != None:
            for tmptext in alltext:
                print(f"id: {tmptext.viewID} - name: {tmptext.variableName}")
                ReturnValue.append( {"id": tmptext.viewID, "name": tmptext.variableName} )
        return ReturnValue
    def CheckSameState(self,_Source,_Target):
        ReturnValue = True
        if(_Target.m_ListView != None):
            iSourceLegnth = len(_Source.m_ListView)
            iTargetLength = len(_Target.m_ListView)
            if(iSourceLegnth == iTargetLength):
                for i in range(iTargetLength):
                    if(_Source.m_ListView[i].m_iID != _Target.m_ListView[i].m_iID):
                        ReturnValue = False
                        break
            else:
                ReturnValue = False
        else:
            ReturnValue = False
        return ReturnValue   
    def Event_ClientError(self,_Input):
        self.m_print('Client Error!!!!!!!!!!!!')
        self.m_iTryTimes += 1
        self.m_bFinished = True
        self.ClearState()
    def StartListen(self):
        ListenSocket = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        ListenSocket.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
        ListenSocket.bind(('', self.m_iPort))
        ListenSocket.listen(5)
        ListenSocket.settimeout(20)

        return ListenSocket
    def GetVisitedState(self):
        return self.m_ListVisitedState   

if __name__ == '__main__':
    #signal.signal(signal.SIGINT, signal_handler)
    parser = ArgumentParser()
    parser.add_argument("-f", "--file", dest="apk_path",
                    help="apk file path", metavar="FILE")
    args = parser.parse_args()
    a, d, dx = 1,2,3
    Server = ControlServer(SETTING.PORT)
    Server.Set_IssueState([
    'Lcom/example/mynewdiva/HelloWorld;', 
    'Lcom/example/mynewdiva/ButtonTestActivity;', 
    'Lcom/example/mynewdiva/HardCodeLogin;', 
    'Lcom/example/mynewdiva/APICreds2Activity;', 
    'Lcom/example/mynewdiva/AccessControl2Activity;', 
    'Lcom/example/mynewdiva/APICredsActivity;', 
    'Lcom/example/mynewdiva/AccessControl1Activity;', 
    'Lcom/example/mynewdiva/InputValidation2URISchemeActivity;', 
    'Lcom/example/mynewdiva/SQLInjectionActivity;', 
    'Lcom/example/mynewdiva/InsecureDataStorage4Activity;', 
    'Lcom/example/mynewdiva/InsecureDataStorage3Activity;', 
    'Lcom/example/mynewdiva/InsecureDataStorage2Activity;', 
    'Lcom/example/mynewdiva/LogActivity;', 
    'Lcom/example/mynewdiva/NotesProvider;'], ['Lcom/example/mynewdiva/HelloWorld;', 'Lcom/example/mynewdiva/MainActivity;', 'Lcom/example/mynewdiva/ButtonTestActivity;', 'Lcom/example/mynewdiva/HardCodeLogin;', 'Lcom/example/mynewdiva/APICreds2Activity;', 'Lcom/example/mynewdiva/AccessControl2Activity;', 'Lcom/example/mynewdiva/APICredsActivity;', 'Lcom/example/mynewdiva/AccessControl1Activity;', 'Lcom/example/mynewdiva/InputValidation2URISchemeActivity;', 'Lcom/example/mynewdiva/SQLInjectionActivity;', 'Lcom/example/mynewdiva/InsecureDataStorage4Activity;', 'Lcom/example/mynewdiva/InsecureDataStorage3Activity;', 'Lcom/example/mynewdiva/InsecureDataStorage2Activity;', 'Lcom/example/mynewdiva/LogActivity;', 'Lcom/example/mynewdiva/NotesProvider;'])
    # Server.Set_IssueState(['Ljakhar/aseem/diva/LogActivity;', 
    # 'Ljakhar/aseem/diva/InsecureDataStorage2Activity;', 
    # 'Ljakhar/aseem/diva/InsecureDataStorage3Activity;', 
    # 'Ljakhar/aseem/diva/InsecureDataStorage4Activity;', 
    # 'Ljakhar/aseem/diva/SQLInjectionActivity;', 
    # 'Ljakhar/aseem/diva/InputValidation2URISchemeActivity;', 
    # 'Ljakhar/aseem/diva/AccessControl1Activity;', 
    # 'Ljakhar/aseem/diva/APICredsActivity;', 
    # 'Ljakhar/aseem/diva/AccessControl2Activity;', 
    # 'Ljakhar/aseem/diva/APICreds2Activity;', 
    # 'Ljakhar/aseem/diva/NotesProvider;'], ['Ljakhar/aseem/diva/MainActivity;', 'Ljakhar/aseem/diva/LogActivity;', 'Ljakhar/aseem/diva/InsecureDataStorage2Activity;', 'Ljakhar/aseem/diva/InsecureDataStorage3Activity;', 'Ljakhar/aseem/diva/InsecureDataStorage4Activity;', 'Ljakhar/aseem/diva/SQLInjectionActivity;', 'Ljakhar/aseem/diva/InputValidation2URISchemeActivity;', 'Ljakhar/aseem/diva/AccessControl1Activity;', 'Ljakhar/aseem/diva/APICredsActivity;', 'Ljakhar/aseem/diva/AccessControl2Activity;', 'Ljakhar/aseem/diva/APICreds2Activity;', 'Ljakhar/aseem/diva/NotesProvider;'])
    Server.Start()