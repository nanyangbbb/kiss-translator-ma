import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";

export default function Header() {
  return (
    <Stack
      direction="row"
      justifyContent="space-between"
      alignItems="center"
      spacing={2}
    >
      <Stack direction="row" justifyContent="flex-start" alignItems="center">
        <Typography
          component="div"
          sx={{
            userSelect: "none",
            WebkitUserSelect: "none",
            fontWeight: "bold",
          }}
        >
          {`${process.env.REACT_APP_NAME} v${process.env.REACT_APP_VERSION}`}
        </Typography>
      </Stack>
    </Stack>
  );
}
