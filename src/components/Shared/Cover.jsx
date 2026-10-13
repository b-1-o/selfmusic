export default function Cover({ track, large = false }) {
  return (
    <div className={"cover" + (large ? " cover-large" : "")}>
      <img
        src={track?.artworkUrl || "/icon.svg"}
        alt=""
        loading="lazy"
        onError={(event) => {
          if (event.currentTarget.dataset.fallback !== "1") {
            event.currentTarget.dataset.fallback = "1";
            event.currentTarget.src = "/icon.svg";
          }
        }}
      />
      <span className="cover-glow" />
    </div>
  );
}