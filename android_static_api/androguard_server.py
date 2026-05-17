import os
import re
import time
import zipfile
import subprocess
import tempfile
import json
from flask import Flask, request, jsonify, send_file
from androguard.misc import AnalyzeAPK

a = None
d = None
dx = None
apk_path = None
TMP_DIR = "Reports/"

class FilteringEngine:
    """
    Placeholder for filtering engine to check if class name is excluded.
    Replace with actual implementation based on your exclusion logic.
    """
    @staticmethod
    def is_class_name_not_in_exclusion(class_name):
        # Placeholder: Assume all classes are included unless specified
        excluded_packages = ["Landroid/", "Landroidx/", "Lcom/google/", "Lkotlin/", "Lkotlinx/", "Lorg/"]  # exclusions packages
        
        # Debug: Print the class name being checked
        #print(f"DEBUG: Checking class: {class_name}")
        
        for pkg in excluded_packages:
            if class_name.startswith(pkg):
                #print(f"DEBUG: Class {class_name} starts with {pkg} - EXCLUDED")
                return False
        
        #print(f"DEBUG: Class {class_name} - INCLUDED")
        return True


def check_server_health(port: int, timeout: int = 300):
    """
    Check if the androguard server is ready by checking for a flag file.
    """
    start_time = time.time()
    flag_file = f"androguard_ready_{port}.flag"
    
    while time.time() - start_time < timeout:
        if os.path.exists(flag_file):
            # Delete the flag file after finding it
            try:
                os.remove(flag_file)
                print(f"[Androguard] Cleaned up flag file: {flag_file}")
            except OSError as e:
                print(f"[Warning] Failed to delete flag file {flag_file}: {e}")
            return True, "Server is ready (flag file found and cleaned up)"
        time.sleep(0.1)  # Check every 100ms
    
    return False, f"Server did not become ready within {timeout} seconds"

 


def run_androguard_server(port: int, apk_path: str):

    app = Flask(__name__)
    # Debug: Print the types of returned objects
    # print(f'DEBUG: Type of a: {type(a)}')
    # print(f'DEBUG: Type of d: {type(d)}')
    # print(f'DEBUG: Type of dx: {type(dx)}')
    
    # If d is a list (multiple DEX files), we need to handle it differently
    if isinstance(d, list):
        print(f'DEBUG: d is a list with {len(d)} items')
        for i, dex in enumerate(d):
            print(f'DEBUG: d[{i}] type: {type(dex)}')
    else:
        print(f'DEBUG: d is not a list, it is: {type(d)}')
    
    # Create a flag file to indicate analysis is complete
    flag_file = f"androguard_ready_{port}.flag"
    with open(flag_file, 'w') as f:
        f.write("ready")
    print(f'androguard_server: Created ready flag file: {flag_file}')

    #find specific method calls by instructions
    def find_method_calls(dx, target_class=None, target_method=None):
        found_calls = []
        
        for class_name, cls_value in dx.classes.items():
            for method in cls_value.get_methods():
                method_analysis = method.get_method()
                if method_analysis and hasattr(method_analysis, 'get_instructions'):
                    instructions = list(method_analysis.get_instructions())
                    
                    for i, instruction in enumerate(instructions):
                        ins_output = instruction.get_output()
                        if target_class in ins_output and target_method in ins_output:
                            found_calls.append({
                                'class': class_name,
                                'method': method.name,
                                'instructions': instructions,
                                'call_index': i
                            })
                
        return found_calls
    
    @app.route('/load_apk', methods=['POST'])
    def load_apk():
        global a, d, dx, apk_path
        if 'file' not in request.files:
            return jsonify({"error": "No file part"}), 400

        file = request.files['file']
        if file.filename == '':
            return jsonify({"error": "No selected file"}), 400

        save_path = os.path.join("./uploads", file.filename)
        os.makedirs(os.path.dirname(save_path), exist_ok=True)
        file.save(save_path)
        apk_path = save_path

        try:
            a, d, dx = AnalyzeAPK(apk_path)
        except Exception as e:
            a, d, dx = None, None, None
            return jsonify({"error": f"Failed to analyze APK: {str(e)}"}), 500

        # Create a flag file to signal readiness
        flag_file = f"androguard_ready.flag"
        with open(flag_file, 'w') as f:
            f.write("ready")

        return jsonify({"message": f"APK loaded and analyzed: {file.filename}"}), 200

    @app.route('/run_maldroid', methods=['POST'])
    def run_maldroid_endpoint():
        global apk_path

        if not apk_path or not os.path.exists(apk_path):
            return jsonify({
                "error": "No APK loaded or invalid path",
                "apk_path": apk_path
            }), 400

        try:
            cmd = [
                "python2",
                "./Frida/maldroid/maldroid_main.py",
                "-s",
                "-v",
                "-f",
                apk_path,
                "-n",
                "file",
                "-u",
                "root"
            ]

            print(f"[DEBUG] Running command: {' '.join(cmd)}")
            result = subprocess.run(cmd, capture_output=True, text=True)
            print(f"[DEBUG] Return code: {result.returncode}")
            print(f"[DEBUG] STDOUT:\n{result.stdout}")
            print(f"[DEBUG] STDERR:\n{result.stderr}")

            if result.returncode != 0:
                return jsonify({
                    "error": "Maldroid analysis failed",
                    "stderr": result.stderr,
                    "returncode": result.returncode
                }), 500

            return jsonify({
                "message": "Maldroid analysis completed successfully",
                "stderr": result.stderr
            }), 200

        except Exception as e:
            import traceback
            tb = traceback.format_exc()
            print(f"[ERROR] Exception in run_maldroid:\n{tb}")
            return jsonify({"error": str(e), "traceback": tb}), 500

    """
    @app.route('/store_json', methods=['POST'])
    def store_json():
        global TMP_DIR
        if not os.path.exists(TMP_DIR):
            os.makedirs(TMP_DIR)
            
        try:
            data = request.get_json()
            if not data:
                return jsonify({"error": "No JSON data provided"}), 400

            filename = data.get("filename")
            file_path = os.path.join(TMP_DIR, filename)

            content = data.get("content", data)
            with open(file_path, "w") as f:
                json.dump(content, f, indent=2)

            return jsonify({
                "message": "JSON data saved successfully",
                "file_path": file_path
            }), 200

        except Exception as e:
            return jsonify({"error": f"Failed to save JSON: {str(e)}"}), 500
    """

    @app.route('/get_json', methods=['GET'])
    def get_json():
        try:
            file_hash = request.args.get("hash")
            if not file_hash:
                return jsonify({"error": "No hash parameter provided"}), 400

            filename = f"{file_hash}_static.json"
            file_path = os.path.join("./Reports", filename)

            if not os.path.exists(file_path):
                return jsonify({"error": "File not found", "file_path": file_path}), 404

            with open(file_path, "r") as f:
                content = json.load(f)
            
            return jsonify(content), 200

        except Exception as e:
            import traceback
            print(traceback.format_exc())  # prints full stack trace to console
            return jsonify({"error": f"Failed to read JSON: {str(e)}"}), 500

    @app.route('/androguard/lab02', methods=['GET'])
    def detect_security_methods():
        #input("Stop! From androguard_server.py LAB_002 ----------- Solving threading issue")
        """
        LAB_002: Detect security-related methods in the APK using regex patterns.

        :return: List of security-related MethodAnalysis objects
        """
        verbose = request.args.get('verbose', 'false').lower() == 'true'
        
        # Regular expressions for filtering methods
        regexGerneralRestricted = ".*(config|setting|constant).*"
        regexSecurityRestricted = ".*(encrypt|decrypt|encod|decod|aes|sha1|sha256|sha512|md5).*"
        prog = re.compile(regexGerneralRestricted, re.I)
        prog_sec = re.compile(regexSecurityRestricted, re.I)

        # Initialize list for security-related methods
        security_methods = []

        # Analyze methods and write to security_methods.txt
        
        # Iterate through all classes and their methods
        for class_name, cls_value in dx.classes.items():
            for method in cls_value.get_methods():
                method_name = method.name  # Use .name instead of .get_name()
                method_class_name = method.class_name  # Use .class_name instead of .get_class_name()
                descriptor = method.descriptor  # Use .descriptor instead of .get_descriptor()

                # Check if method matches restricted patterns
                if prog.match(method_name) or prog_sec.match(method_name):
                    if verbose:
                        print(f"Detected security-related method: {method_class_name}->{method_name}{descriptor}")
                    
                    # Exclude specific methods like onConfigurationChanged
                    if (method_name != 'onConfigurationChanged' or 
                        descriptor != '(Landroid/content/res/Configuration;)V'):
                        # Debug: Check if class is being filtered
                        should_include = FilteringEngine.is_class_name_not_in_exclusion(method_class_name)
                        if verbose:
                            print(f"Class: {method_class_name}, Should include: {should_include}")
                        
                        if should_include:
                            # Convert method object to serializable format
                            method_info = {
                                "class_name": method_class_name,
                                "method_name": method_name,
                            }
                            security_methods.append(method_info)
                          
        return jsonify(security_methods), 200


    @app.route('/androguard/lab03', methods=['GET'])
    def detect_security_classes():
        """
        LAB_003: Detect security-related classes in the APK using regex patterns.

        :return: List of security-related class names
        """
        verbose = request.args.get('verbose', 'false').lower() == 'true'
        
        # Regular expressions for filtering classes (same as in maldroid_main.py)
        regexGerneralRestricted = ".*(config|setting|constant).*"
        regexSecurityRestricted = ".*(encrypt|decrypt|encod|decod|aes|sha1|sha256|sha512|md5).*"
        prog = re.compile(regexGerneralRestricted, re.I)
        prog_sec = re.compile(regexSecurityRestricted, re.I)

        # Initialize list for security-related classes
        security_classes = []

        # Iterate through all classes
        for class_name, cls_value in dx.classes.items():
            # Check if class name matches restricted patterns
            if prog.match(class_name) or prog_sec.match(class_name):
                if verbose:
                    print(f"Detected security-related class: {class_name}")
                
                # Check if class should be included (not in exclusion list)
                should_include = FilteringEngine.is_class_name_not_in_exclusion(class_name)
                if verbose:
                    print(f"Class: {class_name}, Should include: {should_include}")
                
                if should_include:
                    # Convert class object to serializable format
                    class_info = {
                        "class_name": class_name,
                    }
                    security_classes.append(class_info)
                          
        return jsonify(security_classes), 200
 
    @app.route('/androguard/lab16', methods=['GET'])
    def get_apk_lab16():
        """
        Get the number of classes.dex in the APK.
        Unzip the APK and get the number of classes.dex.
        """
        with zipfile.ZipFile(apk_path, 'r') as zip_ref:
            all_files = zip_ref.namelist()
            match_files = [file for file in all_files if file.endswith('classes.dex')]
            if not match_files:
                return jsonify({
                    "count": 0,
                    "message": "No classes.dex file found in the APK"
                }), 200
            else:
                return jsonify({
                    "count": len(match_files),
                    "message": f"Found {len(match_files)} classes.dex file(s) in the APK"
                }), 200
    @app.route('/androguard/lab031', methods=['GET'])
    def get_apk_lab031():
        """ Find Landroid/net/SSLCertificateSocketFactory getInsecure """
        results = []
        found_calls = find_method_calls(dx, target_class="Landroid/net/SSLCertificateSocketFactory", target_method="getInsecure")
        for call in found_calls:
            results.append({
                'class_name': call['class'],
                'method_name': call['method']
            })
        
        return jsonify({
            "results": results
        })  

    @app.route('/androguard/lab038', methods=['GET'])
    def get_apk_lab038():
        """ Find Ljava/lang/System loadLibrary """
        results = []
        found_calls = find_method_calls(dx, target_class="Ljava/lang/System", target_method="loadLibrary")
        for call in found_calls:
            results.append({
                'class_name': call['class'],
                'method_name': call['method']
            })
        return jsonify({
            "results": results
        })
    @app.route('/androguard/permissions', methods=['GET'])
    def get_apk_permissions():
        """
        Get all permissions declared in the APK.

        :return: List of all permissions
        """
        try:
            # Get all permissions from the APK
            permissions = a.get_permissions()
            
            # Convert to list format for JSON serialization
            permission_list = list(permissions) if permissions else []
            
            return jsonify({
                "permissions": permission_list,
                "count": len(permission_list)
            }), 200
            
        except Exception as e:
            return jsonify({
                "error": f"Failed to get permissions: {str(e)}"
            }), 500

    @app.route('/androguard/strings', methods=['GET'])
    def get_apk_strings():
        """
        Get all strings from the APK.

        :return: List of all strings
        """
        try:
            # Get all strings from the APK using dx (VMAnalysis)
            strings = []
            
            # Use dx.get_strings_analysis() which returns a dictionary of StringAnalysis objects
            if hasattr(dx, 'get_strings_analysis'):
                strings_analysis = dx.get_strings_analysis()
                print(f"DEBUG: Got strings_analysis: {type(strings_analysis)}")
                
                # Convert StringAnalysis objects to string values and filter readable strings
                if isinstance(strings_analysis, dict):
                    all_strings = list(strings_analysis.keys())
                    print(f"DEBUG: Extracted {len(all_strings)} total strings from strings_analysis")
                    
                    # Filter out non-readable strings
                    for string in all_strings:
                        # Skip empty strings
                        if not string or string.strip() == "":
                            continue
                        
                        # Skip strings with too many control characters
                        control_chars = sum(1 for c in string if ord(c) < 32 and c not in '\n\r\t')
                        if control_chars > len(string) * 0.3:  # More than 30% control chars
                            continue
                        
                        # Skip strings that are too short (likely not meaningful)
                        if len(string.strip()) < 3:
                            continue
                        
                        # Skip strings that are mostly special characters
                        special_chars = sum(1 for c in string if not c.isalnum() and not c.isspace() and c not in '.-_/@:')
                        if special_chars > len(string) * 0.8:  # More than 80% special chars
                            continue
                        
                        strings.append(string)
                    
                    print(f"DEBUG: Filtered to {len(strings)} readable strings")
                else:
                    print(f"DEBUG: strings_analysis is not a dict: {type(strings_analysis)}")
            else:
                print(f"DEBUG: dx does not have get_strings_analysis method")
            
            # Convert to list format for JSON serialization
            string_list = list(strings) if strings else []
            
            return jsonify({
                "strings": string_list,
                "count": len(string_list)
            }), 200
            
        except Exception as e:
            return jsonify({
                "error": f"Failed to get strings: {str(e)}"
            }), 500


    @app.route('/androguard/files', methods=['GET'])
    def get_apk_files():
        """
        Get all files from the APK.
        """
        try: 
            # Get all files from the APK
            files = a.get_files()
            
            # Convert to list format for JSON serialization
            file_list = list(files) if files else []
            
            return jsonify({
                "files": file_list,
                "count": len(file_list)
            }), 200
            
        except Exception as e:
            return jsonify({
                "error": f"Failed to get files: {str(e)}"
            }), 500


    @app.route('/androguard/lab23/some_other_api', methods=['GET'])
    def some_other_api_lab23():
        response = {"message": "This is some other API"}
        return jsonify(response), 200
    
    @app.route('/androguard/find_method', methods=['GET'])
    def find_method():
        classname = request.args.get('classname')
        methodname = request.args.get('methodname')

        print("find_method")
        
        if not classname or not methodname:
            return jsonify({"error": "Missing parameters"}), 400
        
        methods = list(dx.find_methods(classname=classname, methodname=methodname))
        print("methods: ", methods)
        
        if methods:
            response = {"method_found": True}
            return jsonify(response), 200
        else:
            response = {"method_found": False}
            return jsonify(response), 200
        # input("Stop!")  # Commented out to prevent server hanging
        # for method in methods:
        #     print("Method:", method.name)
        #     print("Descriptor:", method.descriptor)
        #     method_analysis = method.get_method()
        #     print('type of method_analysis', type(method_analysis))
        #     print('method_analysis: ', method_analysis)

        #     # print_methods_attributes(method)
        #     print(method.get_xref_from())
        #     print(method.get_xref_to())
        #     print(method.is_android_api())
        #     print(method.is_external())
    
    @app.route('/androguard/search_packages', methods=['GET'])
    def search_packages():
        """
        Simple endpoint to get package names from APK classes.
        """
        try:
            packages = set()
            
            # Extract package names from class names
            for class_name in dx.classes.keys():
                if class_name.startswith('L') and class_name.endswith(';'):
                    # Remove L prefix and ; suffix, then split by /
                    parts = class_name[1:-1].split('/')
                    if len(parts) > 1:
                        # Get package name (everything except the last part which is the class name)
                        package = '/'.join(parts[:-1])
                        packages.add(package)
            
            # Convert to list and sort
            package_list = sorted(list(packages))
            
            return jsonify({
                "packages": package_list,
                "count": len(package_list)
            }), 200
            
        except Exception as e:
            return jsonify({
                "error": f"Failed to get packages: {str(e)}"
            }), 500

    @app.route('/androguard/classes', methods=['GET'])
    def get_all_classes():
        """
        Get all class names from the APK.
        """
        try:
            classes = list(dx.classes.keys())
            
            return jsonify({
                "classes": classes,
                "count": len(classes)
            }), 200
            
        except Exception as e:
            return jsonify({
                "error": f"Failed to get classes: {str(e)}"
            }), 500

    @app.route('/androguard/search', methods=['GET'])
    def simple_search():
        """Search for strings in APK methods"""
        search_string = request.args.get('q', '')
        if not search_string:
            return jsonify({"error": "Need 'q' parameter"}), 400
        
        results = []
        for class_name, cls_value in dx.classes.items():
            if not FilteringEngine.is_class_name_not_in_exclusion(class_name):
                continue
            
            for method in cls_value.get_methods():
                try:
                    # Get method analysis object
                    method_analysis = method.get_method()
                    if method_analysis is None:
                        continue
                    
                    # Get instructions from method analysis
                    instructions = method_analysis.get_instructions()
                    if instructions is None:
                        continue
                    
                    for instruction in instructions:
                        if instruction.get_op_value() in [0x1A, 0x1B]:
                            string_value = instruction.get_string()
                            if search_string.lower() in string_value.lower():
                                results.append({
                                    "class": method.class_name,
                                    "method": method.name,
                                    "string": string_value
                                })
                except Exception as e:
                    # Skip methods that can't be analyzed
                    continue
        
        return jsonify({"results": results, "count": len(results)})

    @app.route('/androguard/lab_27', methods=['GET'])
    def detect_screen_capture_prevention():
        """
        Detect screen capture prevention by finding setFlags calls and checking for FLAG_SECURE (0x2000) before it.
        """
        
        def check_for_0x2000_flag(instructions, call_index):
            for j in range(max(0, call_index-10), call_index):
                if j < len(instructions):
                    ins = instructions[j]
                    ins_name = ins.get_name()
                    ins_output = ins.get_output()
                    
                    if ins_name in ['const/16', 'const', 'const/4', 'const/high16']:
                        if '0x2000' in ins_output or '8192' in ins_output:
                            return True
            return False
        
        results = []
        
        # Find setFlags calls
        found_calls = find_method_calls(dx, target_class="Landroid/view/Window", target_method="setFlags")
        
        for call in found_calls:
            if check_for_0x2000_flag(call['instructions'], call['call_index']):
                results.append({
                    'flag_value': '0x2000',
                    'class_name': call['class'],
                    'method_name': call['method']
                })
        
        return jsonify({
            "results": results
        })
    @app.route('/androguard/lab_28', methods=['GET'])
    def detect_runtime_exec():
        """
        Detect runtime exec by finding exec calls.
        """
        
        results = []
        
        # Find exec calls
        found_calls = find_method_calls(dx, target_class="Ljava/lang/Runtime", target_method="exec")
        
        for call in found_calls:
            results.append({
                'class_name': call['class'],
                'method_name': call['method']
            })
        
        return jsonify({
            "results": results
        })  
    

    @app.route('/androguard/lab_039', methods=['GET'])
    def detect_framework_bangcle():
        """
        Detect framework bangcle by finding getACall calls.
        """

        results = []
        # Check Libsecese.so
        try:
            allFiles = a.get_files()
            libsecexe_files = [f for f in allFiles if "libsecexe.so" in f]
            if libsecexe_files:  # Check if list is not empty
                results.append({
                    "libsecexe.so": True
                })
        except Exception as e:
            print(f"Error checking libsecexe.so: {e}")
        
        # Check ApplicationWrapper
        target_class = "com.secapk.wrapper.ApplicationWrapper"
        internal_name = "L" + target_class.replace(".", "/") + ";"
        if internal_name in dx.classes:
            results.append({
                "ApplicationWrapper": True
            })
        
        # Check getACall
        found_calls = find_method_calls(dx, target_class="Lcom/secapk/wrapper/ACall", target_method="getACall")
        if found_calls:
            results.append({
                "getACall": True
            })

        return jsonify({
            "results": results
        })

    @app.route('/androguard/lab_040', methods=['GET'])
    def detect_framework_ijiami():
        """
        Detect iJiami framework by finding specific files and methods.
        """
        results = []
        
        # Check libexec.so file
        try:
            allFiles = a.get_files()
            libexec_files = [f for f in allFiles if "libexec.so" in f]
            if libexec_files:
                results.append({
                    "libexec.so": True
                })
        except Exception as e:
            print(f"Error checking libexec.so: {e}")
        
        # Check libexecmain.so file
        try:
            libexecmain_files = [f for f in allFiles if "libexecmain.so" in f]
            if libexecmain_files:
                results.append({
                    "libexecmain.so": True
                })
        except Exception as e:
            print(f"Error checking libexecmain.so: {e}")
        
        # Check NativeApplication class
        target_class = "Lcom/shell/NativeApplication;"
        if target_class in dx.classes:
            results.append({
                "NativeApplication": True
            })
        
        # Check load method
        found_calls = find_method_calls(dx, target_class="Lcom/shell/NativeApplication;", target_method="load")
        if found_calls:
            results.append({
                "load": True
            })
        
        return jsonify({
            "results": results
        })

    @app.route('/androguard/lab_041', methods=['GET'])
    def detect_framework_monodroid():
        """
        Detect MonoDroid framework by finding specific files and classes.
        """
        results = []
        
        # Check libmonodroid.so file
        try:
            allFiles = a.get_files()
            monodroid_files = [f for f in allFiles if "libmonodroid.so" in f]
            if monodroid_files:
                results.append({
                    "libmonodroid.so": True
                })
        except Exception as e:
            print(f"Error checking libmonodroid.so: {e}")
        
        # Check mono.android.app.Application class
        target_class = "Lmono/android/app/Application;"
        if target_class in dx.classes:
            results.append({
                "mono_application": True
            })
        
        return jsonify({
            "results": results
        })
    @app.route('/androguard/lab_054', methods=['GET'])
    def detect_lab_054():
        """
        對應 maldroid_main.py 中的 lab_054 - SQLite Encryption Extension (SEE)
        檢測 Lorg/sqlite/database/sqlite/SQLiteDatabase; 類別
        """
        results = []
        
        # check SQLite Encryption Extension (SEE)
        target_class = "Lorg/sqlite/database/sqlite/SQLiteDatabase;"
        
        if target_class in dx.classes:
            results.append({
                "class_found": True,
                "class_name": target_class,
                "description": "SQLite Encryption Extension (SEE) detected"
            })
        else:
            results.append({
                "class_found": False,
                "class_name": target_class,
                "description": "SQLite Encryption Extension (SEE) not found"
            })
        
        return jsonify({
            "results": results,
        }), 200

    @app.route('/androguard/lab_055', methods=['GET'])
    def detect_lab_055():
        """
        對應 maldroid_main.py 中的 lab_055 - SQLite PRAGMA key encryption
        檢測 PRAGMA key 相關的字串和方法
        """
        results = []
        
        # 搜尋 PRAGMA key 相關的字串
        pragma_key_strings = []
        pragma_key_methods = []
        
        # 1. search for PRAGMA key in strings
        for class_name, cls_value in dx.classes.items():
            # check if the class should be included (not in exclusion list)
            if not FilteringEngine.is_class_name_not_in_exclusion(class_name):
                continue
                
            for method in cls_value.get_methods():
                try:
                    method_analysis = method.get_method()
                    if method_analysis and hasattr(method_analysis, 'get_instructions'):
                        instructions = list(method_analysis.get_instructions())
                        
                        for instruction in instructions:
                            if instruction.get_op_value() in [0x1A, 0x1B]:  # const-string
                                string_value = instruction.get_string()
                                # use regex to check PRAGMA key pattern
                                if re.search(r'PRAGMA\s*key\s*=', string_value, re.IGNORECASE):
                                    pragma_key_strings.append({
                                        "class": method.class_name,
                                        "method": method.name,
                                        "string": string_value,
                                        "description": "PRAGMA key string found"
                                    })
                except Exception as e:
                    # skip methods that can't be analyzed
                    continue
        
        # 2. search execSQL method calls (possibly contains PRAGMA key)
        for class_name, cls_value in dx.classes.items():
            if not FilteringEngine.is_class_name_not_in_exclusion(class_name):
                continue
                
            for method in cls_value.get_methods():
                try:
                    method_analysis = method.get_method()
                    if method_analysis and hasattr(method_analysis, 'get_instructions'):
                        instructions = list(method_analysis.get_instructions())
                        
                        for i, instruction in enumerate(instructions):
                            ins_output = instruction.get_output()
                            if 'execSQL' in ins_output and 'pragma' in ins_output.lower():
                                pragma_key_methods.append({
                                    "class": method.class_name,
                                    "method": method.name,
                                    "instruction": ins_output,
                                    "description": "PRAGMA key in execSQL call"
                                })
                except Exception as e:
                    continue
        
        # 3. combine results
        results = {
            "pragma_key_strings": pragma_key_strings,
            "pragma_key_methods": pragma_key_methods,
            "total_findings": len(pragma_key_strings) + len(pragma_key_methods),
            "lab_id": "lab_055",
            "description": "SQLite PRAGMA key encryption detection"
        }
        
        return jsonify(results), 200
        
    app.run(host='0.0.0.0', port=port)

if __name__ == "__main__":
    os.makedirs("./uploads", exist_ok=True)
    run_androguard_server(8010, None)  # start without APK

    

