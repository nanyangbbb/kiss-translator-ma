import Fab from "@mui/material/Fab";
import TranslateIcon from "@mui/icons-material/Translate";
import ThemeProvider from "../../hooks/Theme";
import Draggable from "./Draggable";
import { useState, useMemo, useCallback } from "react";
import { SettingProvider } from "../../hooks/Setting";
import { MSG_TRANS_TOGGLE, MSG_POPUP_TOGGLE } from "../../config";
import useWindowSize from "../../hooks/WindowSize";

export default function ContentFab({
  fabConfig: { fabClickAction = 0 } = {},
  processActions,
}) {
  const fabWidth = 40;
  const windowSize = useWindowSize();
  const [moved, setMoved] = useState(false);

  const handleStart = useCallback(() => {
    setMoved(false);
  }, []);

  const handleMove = useCallback(() => {
    setMoved(true);
  }, []);

  const handleClick = useCallback(() => {
    if (!moved) {
      if (fabClickAction === 1) {
        processActions({ action: MSG_TRANS_TOGGLE });
      } else {
        processActions({ action: MSG_POPUP_TOGGLE });
      }
    }
  }, [moved, fabClickAction, processActions]);

  const handlePositionChange = useCallback((pos) => {
    window.__KISS_FAB_POSITION__ = pos;
  }, []);

  const fabProps = useMemo(
    () => ({
      windowSize,
      width: fabWidth,
      height: fabWidth,
      left: windowSize.w - fabWidth - 16,
      top: windowSize.h / 2 - fabWidth,
    }),
    [windowSize, fabWidth]
  );

  return (
    <SettingProvider context="fab">
      <ThemeProvider>
        <Draggable
          key="fab"
          {...fabProps}
          onStart={handleStart}
          onMove={handleMove}
          onPositionChange={handlePositionChange}
          handler={
            <Fab size="small" color="primary" onClick={handleClick}>
              <TranslateIcon
                sx={{
                  width: 24,
                  height: 24,
                }}
              />
            </Fab>
          }
        />
      </ThemeProvider>
    </SettingProvider>
  );
}
