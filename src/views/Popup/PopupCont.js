import { useState } from "react";
import Stack from "@mui/material/Stack";
import FormControlLabel from "@mui/material/FormControlLabel";
import Switch from "@mui/material/Switch";
import { sendTabMsg } from "../../libs/msg";
import {
  MSG_TRANS_TOGGLE,
  MSG_TRANS_PUTRULE,
  MSG_TRANSBOX_TOGGLE,
  MSG_READ_TOGGLE,
} from "../../config";
import { kissLog } from "../../libs/log";

export default function PopupCont({ rule, setting, setRule, setSetting, processActions }) {
  const transOpen = rule.transOpen === "true";
  const transOnly = rule.transOnly === "true";
  const tranboxEnabled = setting.tranboxSetting?.transOpen;

  const [bilingualChecked, setBilingualChecked] = useState(!transOnly);
  const [chineseOnlyChecked, setChineseOnlyChecked] = useState(transOnly);

  const sendAction = async (action, args) => {
    if (processActions) {
      processActions({ action, args });
    } else {
      try {
        await sendTabMsg(action, args);
      } catch (err) {
        kissLog(action, err);
      }
    }
  };

  const handleTransToggle = (e) => {
    setRule({ ...rule, transOpen: e.target.checked ? "true" : "false" });
    sendAction(MSG_TRANS_TOGGLE);
  };

  const handleTransboxToggle = (e) => {
    setSetting((pre) => ({
      ...pre,
      tranboxSetting: { ...pre.tranboxSetting, transOpen: e.target.checked },
    }));
    sendAction(MSG_TRANSBOX_TOGGLE);
  };

  const handleBilingualToggle = (e) => {
    if (!e.target.checked) return;
    setBilingualChecked(true);
    setChineseOnlyChecked(false);
    setRule({ ...rule, transOnly: "false" });
    sendAction(MSG_TRANS_PUTRULE, { transOnly: "false" });
  };

  const handleChineseOnlyToggle = (e) => {
    if (!e.target.checked) return;
    setChineseOnlyChecked(true);
    setBilingualChecked(false);
    setRule({ ...rule, transOnly: "true" });
    sendAction(MSG_TRANS_PUTRULE, { transOnly: "true" });
  };

  const handleReadToggle = (e) => {
    const checked = e.target.checked;
    setRule({ ...rule, readOpen: checked ? "true" : "false" });
    sendAction(MSG_TRANS_PUTRULE, { readOpen: checked ? "true" : "false" });
    sendAction(MSG_READ_TOGGLE, { enabled: checked });
  };

  return (
    <Stack sx={{ p: 2 }} spacing={1.5}>
      <FormControlLabel
        control={
          <Switch checked={transOpen} onChange={handleTransToggle} />
        }
        label="翻译开关"
      />
      <FormControlLabel
        control={
          <Switch checked={tranboxEnabled} onChange={handleTransboxToggle} />
        }
        label="划词翻译"
      />
      <FormControlLabel
        control={
          <Switch
            checked={bilingualChecked}
            onChange={handleBilingualToggle}
          />
        }
        label="双语对照"
      />
      <FormControlLabel
        control={
          <Switch
            checked={chineseOnlyChecked}
            onChange={handleChineseOnlyToggle}
          />
        }
        label="全中文显示"
      />
      <FormControlLabel
        control={
          <Switch
            checked={rule.readOpen === "true"}
            onChange={handleReadToggle}
          />
        }
        label="英文朗读"
      />
    </Stack>
  );
}
