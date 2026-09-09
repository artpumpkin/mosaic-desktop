export default function AuroraBackground() {
  return (
    <div
      aria-hidden
      className="fixed inset-0 -z-10 overflow-hidden pointer-events-none"
    >
      <div
        className="aurora-blob"
        style={{
          width: 600,
          height: 600,
          top: -200,
          left: -150,
          background:
            "radial-gradient(circle at center, #6d28d9 0%, transparent 60%)",
          animationDelay: "0s",
        }}
      />
      <div
        className="aurora-blob"
        style={{
          width: 700,
          height: 700,
          top: 100,
          right: -250,
          background:
            "radial-gradient(circle at center, #db2777 0%, transparent 60%)",
          animationDelay: "-7s",
        }}
      />
      <div
        className="aurora-blob"
        style={{
          width: 500,
          height: 500,
          bottom: -150,
          left: "30%",
          background:
            "radial-gradient(circle at center, #0891b2 0%, transparent 60%)",
          animationDelay: "-14s",
        }}
      />
      <div
        className="fixed inset-0 -z-10"
        style={{
          background:
            "radial-gradient(1200px circle at 50% -10%, rgba(124,58,237,0.12), transparent 60%)",
        }}
      />
    </div>
  );
}
