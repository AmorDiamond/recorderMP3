    (function (window) {


        var WORKER_PATH = '/receivingAlarm/lib/recorderMP3/js/recorderWorker.js';
        var encoderWorker = new Worker('/receivingAlarm/lib/recorderMP3/js/mp3Worker.js');
        var Recorder = function (source, cfg) {
            var config = cfg || {};
            var bufferLen = config.bufferLen || 4096;
            var numChannels = config.numChannels || 2;
            this.context = source.context;
            this.node = (this.context.createScriptProcessor ||
            this.context.createJavaScriptNode).call(this.context,
                bufferLen, numChannels, numChannels);
            var worker = new Worker(config.workerPath || WORKER_PATH);
            worker.postMessage({
                command: 'init',
                config: {
                    sampleRate: this.context.sampleRate,
                    numChannels: numChannels
                }
            });
            var recording = false,
                currCallback;

            this.node.onaudioprocess = function (e) {
                if (!recording) return;
                var buffer = [];
                for (var channel = 0; channel < numChannels; channel++) {
                    buffer.push(e.inputBuffer.getChannelData(channel));
                }
                worker.postMessage({
                    command: 'record',
                    buffer: buffer
                });
            }

            this.configure = function (cfg) {
                for (var prop in cfg) {
                    if (cfg.hasOwnProperty(prop)) {
                        config[prop] = cfg[prop];
                    }
                }
            }

            this.record = function () {
                recording = true;
            }

            this.stop = function () {
                recording = false;
            }

            this.clear = function () {
                worker.postMessage({command: 'clear'});
            }

            this.getBuffer = function (cb) {
                currCallback = cb || config.callback;
                worker.postMessage({command: 'getBuffer'})
            }

            var webSocket = '';
            this.exportWAV = function (cb, ws, type) {
                webSocket = ws;
                currCallback = cb || config.callback;
                type = type || config.type || 'audio/wav';
                if (!currCallback) throw new Error('Callback not set');
                worker.postMessage({
                    command: 'exportWAV',
                    type: type
                });
            }
            //Mp3 conversion
            worker.onmessage = function (e) {
                var blob = e.data;
                //console.log("the blob " +  blob + " " + blob.size + " " + blob.type);

                var arrayBuffer;
                var fileReader = new FileReader();

                fileReader.onload = function () {
                    arrayBuffer = this.result;
                    var buffer = new Uint8Array(arrayBuffer),
                        data = parseWav(buffer);

                    console.log(data);
                    console.log("Converting to Mp3");
                    //log.innerHTML += "\n" + "Converting to Mp3";

                    encoderWorker.postMessage({
                        cmd: 'init', config: {
                            mode: 3,
                            channels: 1,
                            samplerate: data.sampleRate,
                            bitrate: data.bitsPerSample
                        }
                    });

                    encoderWorker.postMessage({cmd: 'encode', buf: Uint8ArrayToFloat32Array(data.samples)});
                    encoderWorker.postMessage({cmd: 'finish'});
                    encoderWorker.onmessage = function (e) {
                        if (e.data.cmd == 'data') {

                            console.log("Done converting to Mp3");
                            //log.innerHTML += "\n" + "Done converting to Mp3";

                            /*var audio = new Audio();
                             audio.src = 'data:audio/mp3;base64,'+encode64(e.data.buf);
                             audio.play();*/

                            //console.log ("The Mp3 data " + e.data.buf);

                            var mp3Blob = new Blob([new Uint8Array(e.data.buf)], {type: 'audio/mp3'});

                            uploadAudio(mp3Blob);

//
//				var url = 'data:audio/mp3;base64,'+encode64(e.data.buf);
//				var li = document.createElement('li');
//				var au = document.createElement('audio');
//				var hf = document.createElement('a');
//
//				au.controls = true;
//				au.src = url;
//				hf.href = url;
//				hf.download = 'audio_recording_' + new Date().getTime() + '.mp3';
//				hf.innerHTML = hf.download;
//				li.appendChild(au);
//				li.appendChild(hf);
//				//recordingslist.appendChild(li);

                        }
                    };
                };

                fileReader.readAsArrayBuffer(blob);

                currCallback(blob);
            }


            function encode64(buffer) {
                var binary = '',
                    bytes = new Uint8Array(buffer),
                    len = bytes.byteLength;

                for (var i = 0; i < len; i++) {
                    binary += String.fromCharCode(bytes[i]);
                }
                return window.btoa(binary);
            }

            function parseWav(wav) {
                function readInt(i, bytes) {
                    var ret = 0,
                        shft = 0;

                    while (bytes) {
                        ret += wav[i] << shft;
                        shft += 8;
                        i++;
                        bytes--;
                    }
                    return ret;
                }

                if (readInt(20, 2) != 1) throw 'Invalid compression code, not PCM';
                if (readInt(22, 2) != 1) throw 'Invalid number of channels, not 1';
                return {
                    sampleRate: readInt(24, 4),
                    bitsPerSample: readInt(34, 2),
                    samples: wav.subarray(44)
                };
            }

            function Uint8ArrayToFloat32Array(u8a) {
                var f32Buffer = new Float32Array(u8a.length);
                for (var i = 0; i < u8a.length; i++) {
                    var value = u8a[i << 1] + (u8a[(i << 1) + 1] << 8);
                    if (value >= 0x8000) value |= ~0x7FFF;
                    f32Buffer[i] = value / 0x8000;
                }
                return f32Buffer;
            }

            function uploadAudio(mp3Data) {
                console.log('上传MP3',mp3Data);
                // var reader = new FileReader();
                // reader.onload = function (event) {
                console.log(event)
                var fd = new FormData();
                var mp3Name = encodeURIComponent('audio_recording_' + new Date().getTime() + '.mp3');
                console.log("mp3name = " + mp3Name);
                // fd.append('fname', mp3Name);
                fd.append('file', mp3Data, "voice.mp3");
                $.ajax({
                    type: 'POST',
                    url: '/v1/files/audio/fileUploads',
                    data: fd,
                    processData: false,
                    contentType: false,
                    success: function (responseStr) {

                        /*}).done(function (data) {
                         console.log(data);
                         log.innerHTML += "\n" + data;


                         console.log('成功', responseStr)*/


                        var relativePath = responseStr[0].relativePath;
                        var id = $(".police_left_bg").find("[name=audio_send]").attr("alarm");
                        var target = $(".police_left_bg").find("[name=audio_send]").attr("target");
                        /*var webSocketMsg = {
                            "mgs": {
                                "content": relativePath,
                                "alarmId": id
                            },
                            "messageType": 4,
                            "targetAccount": target,
                            "sendAccount": $("#imAccount").val(),
                            "messageId": new Date().getTime()
                        }*/
                        var time = +new Date();
                        var messageId = msgIdBefore + time;
                        /*消息类型*/
                        var messageType = 1;
                        /*发送人*/
                        var sourcePerson = imAccount;
                        /*设备*/
                        var sourceDevice = nowDevice;
                        /*发送到房间号*/
                        var targetRoom = sendRoomId;
                        /*消息内容*/
                        var messageContext = relativePath + '&AUDIOMSG';
                        var msgData = JSON.stringify({
                          "messageId": messageId,
                          "messageType": messageType,
                          "sourcePerson": sourcePerson,
                          "sourceDevice": sourceDevice,
                          "targetRoom": targetRoom,
                          "messageContext": messageContext
                        });
                        webSocket.send(msgData);
                        var chatRight = $("#chat_right_templete").clone(true);
                        // 移除模板的id
                        chatRight.removeAttr("id");
                        // 消息发送日期
                        chatRight.find("[name=chat_date]").html(formatDate(new Date(), "yyyy-MM-dd hh:mm:ss"));
                        // 设置聊天内容
                        //语音
                        var voiceTemp = $("#voice_temp").clone(true);
                        var voice_jPlayer = voiceTemp.find("[name=jquery_jplayer]");
                        var jp_container = voiceTemp.find("[name=jp_container]");
                        voiceTemp.removeAttr("id");
                        var opt_play_first = false;//如果为true，将尝试在页面加载时自动播放默认曲目。 对iOS等移动设备没有影响。
                        var opt_auto_play = true;//如果为true，当选择一个音轨时，它将自动播放。
                        var opt_text_playing = "正在播放";//播放时的文字
                        var opt_text_selected = "选定曲目"; //不播放文本
                        var first_track = true;//捕获第一个轨道的标志
                        $.jPlayer.timeFormat.padMin = false;
                        $.jPlayer.timeFormat.padSec = false;
                        $.jPlayer.timeFormat.sepMin = " : ";
                        $.jPlayer.timeFormat.sepSec = " ' ";
                        voiceTemp.show();
                        voiceTemp.find("[name=play]").attr("src", '/receivingAlarm/images/yy2.png');
                        voiceTemp.find("[name=pause]").attr("src", '/receivingAlarm/images/yy2.gif');
                        voice_jPlayer.jPlayer({
                            ready: function () {
                              $(".police_left_bg").find("[name=audio_send]").jPlayer("setMedia", {
                                    mp3: "/v1/files/showAudio/" + relativePath
                                });
                            },
                            timeupdate: function (event) {
                                //console.log(parseInt(event.jPlayer.status.currentPercentAbsolute, 10) + "%");
                            },
                            play: function (event) {
                                //设置播放
                                console.log("playing")
                                voiceTemp.find("[name=play]").hide();
                                voiceTemp.find("[name=pause]").show();
                            },
                            pause: function (event) {
                                //设置暂停
                                console.log("pause")
                                voiceTemp.find("[name=play]").show();
                                voiceTemp.find("[name=pause]").hide();
                            },
                            ended: function (event) {
                                //设置结束
                                console.log("ended")
                                voiceTemp.find("[name=play]").show();
                                voiceTemp.find("[name=pause]").hide();

                            },
                            swfPath: "/receivingAlarm/js/jplayer",
                            cssSelectorAncestor: "[name=jp_container]",
                            supplied: "mp3",
                            wmode: "window"
                        });
                        voiceTemp.find("[name=play]").click(function (e) {

                            voice_jPlayer.jPlayer("setMedia", {
                                mp3: "/v1/files/showAudio/" + relativePath
                            });
                            if ((opt_play_first && first_track) || (opt_auto_play && !first_track)) {
                                voice_jPlayer.jPlayer("play");
                            }
                            first_track = false;
                            $(".police_left_bg").find("[name=audio_send]").blur();
                            return false;
                        });
                        voiceTemp.find("[name=pause]").click(function (e) {
                            if ((opt_play_first && first_track) || (opt_auto_play && !first_track)) {
                                voice_jPlayer.jPlayer("pause");
                            }
                            first_track = false;
                            $(".police_left_bg").find("[name=audio_send]").blur();
                            return false;
                        });
                        chatRight.find("[name=chat_content]").append(voiceTemp);
                        // 向聊天窗添加聊天信息
                        $(".police_left_bg").find(".chat_scroll_con").append(chatRight);
                        // 显示
                        chatRight.show();
                        // webSocket.send(JSON.stringify(webSocketMsg));
                        // 跳转到底部下方
                        $("#chat_area_div").mCustomScrollbar("scrollTo", "bottom");
                        $(".police_left_bg").find(".chat_voice_box").hide();
                        $(".police_left_bg").find(".chat_send_voice").removeClass("active");

                    }

                });
                // };
                // reader.readAsDataURL(mp3Data);
            }
          var formatDate = function(nowDate,format){
            var nowStr = null;
            if(nowDate != undefined && nowDate != null){
              nowStr =nowDate.format(format);
            }
            return nowStr;
          };

            source.connect(this.node);
            this.node.connect(this.context.destination);    //this should not be necessary
        };

        /*Recorder.forceDownload = function(blob, filename){
         console.log("Force download");
         var url = (window.URL || window.webkitURL).createObjectURL(blob);
         var link = window.document.createElement('a');
         link.href = url;
         link.download = filename || 'output.wav';
         var click = document.createEvent("Event");
         click.initEvent("click", true, true);
         link.dispatchEvent(click);
         }*/

        window.Recorder = Recorder;

    })(window);