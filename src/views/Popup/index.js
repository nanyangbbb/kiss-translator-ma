import { useState, useEffect } from "react";
import Box from "@mui/material/Box";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import { sendTabMsg } from "../../libs/msg";
import Divider from "@mui/material/Divider";
import Header from "./Header";
import { MSG_TRANS_GETRULE } from "../../config";
import { kissLog } from "../../libs/log";
import PopupCont from "./PopupCont";

export default function Popup() {
  const [rule, setRule] = useState(null);
  const [setting, setSetting] = useState(null);

  useEffect(() => {
    (async () => {
      try {
        const res = await sendTabMsg(MSG_TRANS_GETRULE);
        if (!res.error) {
          setRule(res.rule);
          setSetting(res.setting);
        }
      } catch (err) {
        kissLog("query rule", err);
      }
    })();
  }, []);

  return (
    <Box width={360}>
      <Header />
      <Divider />
      <Box sx={{ overflowY: "auto", maxHeight: 500 }}>
        {rule ? (
          <PopupCont
            rule={rule}
            setting={setting}
            setRule={setRule}
            setSetting={setSetting}
          />
        ) : (
          <Stack sx={{ p: 2 }} alignItems="center">
            <Typography variant="body2" color="text.secondary">
              请刷新页面后重试
            </Typography>
          </Stack>
        )}
      </Box>
    </Box>
  );
}
