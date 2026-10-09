# Tool reference

88 tools are exposed in curated mode. Full mode exposes 168 tools, including all 147 catalog requests. Both modes can access the complete catalog through validated dispatch.

## Workflow and discovery tools

| Tool | Purpose |
| --- | --- |
| `obs_status` | Inspect connection/version, scenes, recording, stream, replay buffer, virtual camera, video settings and performance. Individual unavailable sections include errors. |
| `obs_preflight` | Check scene visibility, unmuted audio-capable inputs and skipped-frame counters before a recording. Reports warnings; it cannot prove microphone signal or streaming readiness. |
| `obs_inspect_scene` | Inspect a named scene or the current program scene, including item IDs, transforms, visibility and source types. Repeated source names require item IDs for edits. |
| `obs_list_requests` | Discover the full OBS API, request schemas and minimum WebSocket versions. With supportedOnly=true, filter against the connected OBS capabilities. Use this before obs_request. |
| `obs_request` | Run one validated OBS API request from obs_list_requests. Unknown operations and invalid arguments are rejected. Never repeat a timed-out mutation without inspecting its outcome. Supports the full catalog in either tool mode. |
| `obs_batch` | Execute up to 100 validated requests sequentially. Every request is validated before any is run. Reports partial results and stops on the first failure by default. This is not an atomic transaction. |
| `obs_screenshot` | Return an actual MCP image of a source or scene, defaulting to the current program scene. Use to visually check framing and layout. No screenshot file is written. |
| `obs_layout_source` | Fit a scene item into a fullscreen, corner, half-screen or custom layout. Returns the previous transform for restoration. Resets cropping, rotation and mirroring. Prefer fit=contain; cover can extend beyond the requested box. |
| `obs_add_source` | Create an OBS input in a scene. Discover inputKind with obs_get_input_kind_list and device/settings choices with GetInputDefaultSettings and GetInputPropertiesListPropertyItems. OBS device settings differ by platform. |
| `obs_build_scene` | Build a new tutorial, gaming, presentation or interview scene using existing sources. Adds a background and optional title. Supports a dry-run plan; on failure attempts cleanup only for newly created objects. Does not change the live scene unless activate=true. |
| `obs_recording` | Start, stop, pause, resume or inspect recording. Waits for OBS to confirm the state change before returning. Stop returns the saved recording path. Check status before issuing commands when the current state is uncertain. |
| `obs_streaming` | Inspect, start or stop streaming with the settings already configured in OBS. Starting sends the current scene to the configured platform immediately. This tool does not configure accounts or disclose stream keys. |
| `obs_replay` | Inspect, start, stop or save the OBS replay buffer, or get the most recent replay path. Duration and encoding must already be configured in OBS. |
| `obs_audio` | Inspect an audio input, or set mute, volume in decibels, sync offset and monitoring. Changes run sequentially and can partially succeed; inspect after a failure. Monitoring modes depend on OBS audio configuration. |
| `obs_transition_to_scene` | Transition the live program to a scene using Studio Mode. Validates the target first, enables Studio Mode, optionally selects a transition/duration, sets preview and triggers the transition. These are global OBS settings and are retained. |
| `obs_set_source_visibility` | Show or hide one source item by source name or item ID. Does not change the source in other scenes. |
| `obs_recent_events` | Read bounded OBS event history since this MCP process connected. IDs are monotonic within this process. Old events are evicted; use nextAfterId to continue polling. This is not persistent monitoring. |
| `obs_wait_for_event` | Wait up to 30 seconds for an OBS event matching a type and cursor. Returns immediately if a matching buffered event exists. On timeout returns matched=false. |
| `obs_schedule_cues` | Schedule up to 100 OBS commands at delays measured from submission, up to one hour. Runs in the background while this MCP process stays alive; stops on the first failure. Jobs do not survive restart. Validate live-output commands carefully. |
| `obs_list_cues` | Read scheduled cue jobs, progress and results for this process. |
| `obs_cancel_cues` | Cancel pending cues for a job. A command already sent to OBS cannot be recalled. |

## OBS request tools

Version requirements refer to obs-websocket, not OBS Studio. Newer requests remain discoverable in the bundled catalog, but unsupported operations return an actionable error.

| Tool | OBS request | Category | Since | Default |
| --- | --- | --- | --- | --- |
| `obs_get_canvas_list` | `GetCanvasList` | canvases | 5.7.0 | Full mode |
| `obs_get_persistent_data` | `GetPersistentData` | config | 5.0.0 | Full mode |
| `obs_set_persistent_data` | `SetPersistentData` | config | 5.0.0 | Full mode |
| `obs_get_scene_collection_list` | `GetSceneCollectionList` | config | 5.0.0 | Yes |
| `obs_set_current_scene_collection` | `SetCurrentSceneCollection` | config | 5.0.0 | Full mode |
| `obs_create_scene_collection` | `CreateSceneCollection` | config | 5.0.0 | Full mode |
| `obs_get_profile_list` | `GetProfileList` | config | 5.0.0 | Yes |
| `obs_set_current_profile` | `SetCurrentProfile` | config | 5.0.0 | Full mode |
| `obs_create_profile` | `CreateProfile` | config | 5.0.0 | Full mode |
| `obs_remove_profile` | `RemoveProfile` | config | 5.0.0 | Full mode |
| `obs_get_profile_parameter` | `GetProfileParameter` | config | 5.0.0 | Full mode |
| `obs_set_profile_parameter` | `SetProfileParameter` | config | 5.0.0 | Full mode |
| `obs_get_video_settings` | `GetVideoSettings` | config | 5.0.0 | Yes |
| `obs_set_video_settings` | `SetVideoSettings` | config | 5.0.0 | Full mode |
| `obs_get_stream_service_settings` | `GetStreamServiceSettings` | config | 5.0.0 | Full mode |
| `obs_set_stream_service_settings` | `SetStreamServiceSettings` | config | 5.0.0 | Full mode |
| `obs_get_record_directory` | `GetRecordDirectory` | config | 5.0.0 | Yes |
| `obs_set_record_directory` | `SetRecordDirectory` | config | 5.3.0 | Yes |
| `obs_get_source_filter_kind_list` | `GetSourceFilterKindList` | filters | 5.4.0 | Full mode |
| `obs_get_source_filter_list` | `GetSourceFilterList` | filters | 5.0.0 | Yes |
| `obs_get_source_filter_default_settings` | `GetSourceFilterDefaultSettings` | filters | 5.0.0 | Full mode |
| `obs_create_source_filter` | `CreateSourceFilter` | filters | 5.0.0 | Yes |
| `obs_remove_source_filter` | `RemoveSourceFilter` | filters | 5.0.0 | Yes |
| `obs_set_source_filter_name` | `SetSourceFilterName` | filters | 5.0.0 | Full mode |
| `obs_get_source_filter` | `GetSourceFilter` | filters | 5.0.0 | Full mode |
| `obs_set_source_filter_index` | `SetSourceFilterIndex` | filters | 5.0.0 | Full mode |
| `obs_set_source_filter_settings` | `SetSourceFilterSettings` | filters | 5.0.0 | Yes |
| `obs_set_source_filter_enabled` | `SetSourceFilterEnabled` | filters | 5.0.0 | Yes |
| `obs_get_version` | `GetVersion` | general | 5.0.0 | Full mode |
| `obs_get_stats` | `GetStats` | general | 5.0.0 | Full mode |
| `obs_broadcast_custom_event` | `BroadcastCustomEvent` | general | 5.0.0 | Full mode |
| `obs_call_vendor_request` | `CallVendorRequest` | general | 5.0.0 | Full mode |
| `obs_get_hotkey_list` | `GetHotkeyList` | general | 5.0.0 | Full mode |
| `obs_trigger_hotkey_by_name` | `TriggerHotkeyByName` | general | 5.0.0 | Full mode |
| `obs_trigger_hotkey_by_key_sequence` | `TriggerHotkeyByKeySequence` | general | 5.0.0 | Full mode |
| `obs_sleep` | `Sleep` | general | 5.0.0 | Full mode |
| `obs_get_input_list` | `GetInputList` | inputs | 5.0.0 | Yes |
| `obs_get_input_kind_list` | `GetInputKindList` | inputs | 5.0.0 | Yes |
| `obs_get_special_inputs` | `GetSpecialInputs` | inputs | 5.0.0 | Full mode |
| `obs_create_input` | `CreateInput` | inputs | 5.0.0 | Yes |
| `obs_remove_input` | `RemoveInput` | inputs | 5.0.0 | Yes |
| `obs_set_input_name` | `SetInputName` | inputs | 5.0.0 | Full mode |
| `obs_get_input_default_settings` | `GetInputDefaultSettings` | inputs | 5.0.0 | Full mode |
| `obs_get_input_settings` | `GetInputSettings` | inputs | 5.0.0 | Yes |
| `obs_set_input_settings` | `SetInputSettings` | inputs | 5.0.0 | Yes |
| `obs_get_input_mute` | `GetInputMute` | inputs | 5.0.0 | Yes |
| `obs_set_input_mute` | `SetInputMute` | inputs | 5.0.0 | Yes |
| `obs_toggle_input_mute` | `ToggleInputMute` | inputs | 5.0.0 | Full mode |
| `obs_get_input_volume` | `GetInputVolume` | inputs | 5.0.0 | Yes |
| `obs_set_input_volume` | `SetInputVolume` | inputs | 5.0.0 | Yes |
| `obs_get_input_audio_balance` | `GetInputAudioBalance` | inputs | 5.0.0 | Full mode |
| `obs_set_input_audio_balance` | `SetInputAudioBalance` | inputs | 5.0.0 | Full mode |
| `obs_get_input_audio_sync_offset` | `GetInputAudioSyncOffset` | inputs | 5.0.0 | Yes |
| `obs_set_input_audio_sync_offset` | `SetInputAudioSyncOffset` | inputs | 5.0.0 | Yes |
| `obs_get_input_audio_monitor_type` | `GetInputAudioMonitorType` | inputs | 5.0.0 | Yes |
| `obs_set_input_audio_monitor_type` | `SetInputAudioMonitorType` | inputs | 5.0.0 | Yes |
| `obs_get_input_audio_tracks` | `GetInputAudioTracks` | inputs | 5.0.0 | Full mode |
| `obs_set_input_audio_tracks` | `SetInputAudioTracks` | inputs | 5.0.0 | Full mode |
| `obs_get_input_deinterlace_mode` | `GetInputDeinterlaceMode` | inputs | 5.6.0 | Full mode |
| `obs_set_input_deinterlace_mode` | `SetInputDeinterlaceMode` | inputs | 5.6.0 | Full mode |
| `obs_get_input_deinterlace_field_order` | `GetInputDeinterlaceFieldOrder` | inputs | 5.6.0 | Full mode |
| `obs_set_input_deinterlace_field_order` | `SetInputDeinterlaceFieldOrder` | inputs | 5.6.0 | Full mode |
| `obs_get_input_properties_list_property_items` | `GetInputPropertiesListPropertyItems` | inputs | 5.0.0 | Yes |
| `obs_press_input_properties_button` | `PressInputPropertiesButton` | inputs | 5.0.0 | Full mode |
| `obs_get_media_input_status` | `GetMediaInputStatus` | media inputs | 5.0.0 | Yes |
| `obs_set_media_input_cursor` | `SetMediaInputCursor` | media inputs | 5.0.0 | Yes |
| `obs_offset_media_input_cursor` | `OffsetMediaInputCursor` | media inputs | 5.0.0 | Full mode |
| `obs_trigger_media_input_action` | `TriggerMediaInputAction` | media inputs | 5.0.0 | Yes |
| `obs_get_virtual_cam_status` | `GetVirtualCamStatus` | outputs | 5.0.0 | Yes |
| `obs_toggle_virtual_cam` | `ToggleVirtualCam` | outputs | 5.0.0 | Full mode |
| `obs_start_virtual_cam` | `StartVirtualCam` | outputs | 5.0.0 | Yes |
| `obs_stop_virtual_cam` | `StopVirtualCam` | outputs | 5.0.0 | Yes |
| `obs_get_replay_buffer_status` | `GetReplayBufferStatus` | outputs | 5.0.0 | Yes |
| `obs_toggle_replay_buffer` | `ToggleReplayBuffer` | outputs | 5.0.0 | Full mode |
| `obs_start_replay_buffer` | `StartReplayBuffer` | outputs | 5.0.0 | Yes |
| `obs_stop_replay_buffer` | `StopReplayBuffer` | outputs | 5.0.0 | Yes |
| `obs_save_replay_buffer` | `SaveReplayBuffer` | outputs | 5.0.0 | Yes |
| `obs_get_last_replay_buffer_replay` | `GetLastReplayBufferReplay` | outputs | 5.0.0 | Yes |
| `obs_get_output_list` | `GetOutputList` | outputs | 5.0.0 | Full mode |
| `obs_get_output_status` | `GetOutputStatus` | outputs | 5.0.0 | Full mode |
| `obs_toggle_output` | `ToggleOutput` | outputs | 5.0.0 | Full mode |
| `obs_start_output` | `StartOutput` | outputs | 5.0.0 | Full mode |
| `obs_stop_output` | `StopOutput` | outputs | 5.0.0 | Full mode |
| `obs_get_output_settings` | `GetOutputSettings` | outputs | 5.0.0 | Full mode |
| `obs_set_output_settings` | `SetOutputSettings` | outputs | 5.0.0 | Full mode |
| `obs_get_record_status` | `GetRecordStatus` | record | 5.0.0 | Yes |
| `obs_toggle_record` | `ToggleRecord` | record | 5.0.0 | Full mode |
| `obs_start_record` | `StartRecord` | record | 5.0.0 | Yes |
| `obs_stop_record` | `StopRecord` | record | 5.0.0 | Yes |
| `obs_toggle_record_pause` | `ToggleRecordPause` | record | 5.0.0 | Full mode |
| `obs_pause_record` | `PauseRecord` | record | 5.0.0 | Yes |
| `obs_resume_record` | `ResumeRecord` | record | 5.0.0 | Yes |
| `obs_split_record_file` | `SplitRecordFile` | record | 5.5.0 | Full mode |
| `obs_create_record_chapter` | `CreateRecordChapter` | record | 5.5.0 | Full mode |
| `obs_get_scene_item_list` | `GetSceneItemList` | scene items | 5.0.0 | Yes |
| `obs_get_group_scene_item_list` | `GetGroupSceneItemList` | scene items | 5.0.0 | Yes |
| `obs_get_scene_item_id` | `GetSceneItemId` | scene items | 5.0.0 | Yes |
| `obs_get_scene_item_source` | `GetSceneItemSource` | scene items | 5.4.0 | Full mode |
| `obs_create_scene_item` | `CreateSceneItem` | scene items | 5.0.0 | Yes |
| `obs_remove_scene_item` | `RemoveSceneItem` | scene items | 5.0.0 | Yes |
| `obs_duplicate_scene_item` | `DuplicateSceneItem` | scene items | 5.0.0 | Yes |
| `obs_get_scene_item_transform` | `GetSceneItemTransform` | scene items | 5.0.0 | Yes |
| `obs_set_scene_item_transform` | `SetSceneItemTransform` | scene items | 5.0.0 | Yes |
| `obs_get_scene_item_enabled` | `GetSceneItemEnabled` | scene items | 5.0.0 | Full mode |
| `obs_set_scene_item_enabled` | `SetSceneItemEnabled` | scene items | 5.0.0 | Yes |
| `obs_get_scene_item_locked` | `GetSceneItemLocked` | scene items | 5.0.0 | Full mode |
| `obs_set_scene_item_locked` | `SetSceneItemLocked` | scene items | 5.0.0 | Yes |
| `obs_get_scene_item_index` | `GetSceneItemIndex` | scene items | 5.0.0 | Full mode |
| `obs_set_scene_item_index` | `SetSceneItemIndex` | scene items | 5.0.0 | Yes |
| `obs_get_scene_item_blend_mode` | `GetSceneItemBlendMode` | scene items | 5.0.0 | Full mode |
| `obs_set_scene_item_blend_mode` | `SetSceneItemBlendMode` | scene items | 5.0.0 | Full mode |
| `obs_get_scene_list` | `GetSceneList` | scenes | 5.0.0 | Yes |
| `obs_get_group_list` | `GetGroupList` | scenes | 5.0.0 | Full mode |
| `obs_get_current_program_scene` | `GetCurrentProgramScene` | scenes | 5.0.0 | Yes |
| `obs_set_current_program_scene` | `SetCurrentProgramScene` | scenes | 5.0.0 | Yes |
| `obs_get_current_preview_scene` | `GetCurrentPreviewScene` | scenes | 5.0.0 | Full mode |
| `obs_set_current_preview_scene` | `SetCurrentPreviewScene` | scenes | 5.0.0 | Yes |
| `obs_create_scene` | `CreateScene` | scenes | 5.0.0 | Yes |
| `obs_remove_scene` | `RemoveScene` | scenes | 5.0.0 | Yes |
| `obs_set_scene_name` | `SetSceneName` | scenes | 5.0.0 | Yes |
| `obs_get_scene_scene_transition_override` | `GetSceneSceneTransitionOverride` | scenes | 5.0.0 | Full mode |
| `obs_set_scene_scene_transition_override` | `SetSceneSceneTransitionOverride` | scenes | 5.0.0 | Full mode |
| `obs_get_source_active` | `GetSourceActive` | sources | 5.0.0 | Full mode |
| `obs_get_source_screenshot` | `GetSourceScreenshot` | sources | 5.0.0 | Full mode |
| `obs_save_source_screenshot` | `SaveSourceScreenshot` | sources | 5.0.0 | Full mode |
| `obs_get_stream_status` | `GetStreamStatus` | stream | 5.0.0 | Yes |
| `obs_toggle_stream` | `ToggleStream` | stream | 5.0.0 | Full mode |
| `obs_start_stream` | `StartStream` | stream | 5.0.0 | Yes |
| `obs_stop_stream` | `StopStream` | stream | 5.0.0 | Yes |
| `obs_send_stream_caption` | `SendStreamCaption` | stream | 5.0.0 | Full mode |
| `obs_get_transition_kind_list` | `GetTransitionKindList` | transitions | 5.0.0 | Full mode |
| `obs_get_scene_transition_list` | `GetSceneTransitionList` | transitions | 5.0.0 | Yes |
| `obs_get_current_scene_transition` | `GetCurrentSceneTransition` | transitions | 5.0.0 | Full mode |
| `obs_set_current_scene_transition` | `SetCurrentSceneTransition` | transitions | 5.0.0 | Yes |
| `obs_set_current_scene_transition_duration` | `SetCurrentSceneTransitionDuration` | transitions | 5.0.0 | Yes |
| `obs_set_current_scene_transition_settings` | `SetCurrentSceneTransitionSettings` | transitions | 5.0.0 | Full mode |
| `obs_get_current_scene_transition_cursor` | `GetCurrentSceneTransitionCursor` | transitions | 5.0.0 | Full mode |
| `obs_trigger_studio_mode_transition` | `TriggerStudioModeTransition` | transitions | 5.0.0 | Yes |
| `obs_set_tbar_position` | `SetTBarPosition` | transitions | 5.0.0 | Full mode |
| `obs_get_studio_mode_enabled` | `GetStudioModeEnabled` | ui | 5.0.0 | Full mode |
| `obs_set_studio_mode_enabled` | `SetStudioModeEnabled` | ui | 5.0.0 | Yes |
| `obs_open_input_properties_dialog` | `OpenInputPropertiesDialog` | ui | 5.0.0 | Full mode |
| `obs_open_input_filters_dialog` | `OpenInputFiltersDialog` | ui | 5.0.0 | Full mode |
| `obs_open_input_interact_dialog` | `OpenInputInteractDialog` | ui | 5.0.0 | Full mode |
| `obs_get_monitor_list` | `GetMonitorList` | ui | 5.0.0 | Full mode |
| `obs_open_video_mix_projector` | `OpenVideoMixProjector` | ui | 5.0.0 | Full mode |
| `obs_open_source_projector` | `OpenSourceProjector` | ui | 5.0.0 | Full mode |

Argument schemas are available through `obs_list_requests` and the `obs://requests` resource. OBS-specific source settings and enum restrictions can require additional checks by OBS itself.
