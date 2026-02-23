if (typeof sessionsData !== "undefined" && sessionsData.length > 0) {
    const labels = [];
    const values = [];

    sessionsData
        .slice()
        .reverse()
        .forEach((s, index) => {
            labels.push(index + 1);
            values.push(s.focus_percent || 0);
        });

    const ctx = document.getElementById("focusChart").getContext("2d");

    new Chart(ctx, {
        type: "line",
        data: {
            labels: labels,
            datasets: [
                {
                    label: "Focus percent",
                    data: values,
                    fill: false,
                },
            ],
        },
        options: {
            responsive: true,
            scales: {
                y: {
                    min: 0,
                    max: 100,
                    title: {
                        display: true,
                        text: "Focus percent",
                    },
                },
                x: {
                    title: {
                        display: true,
                        text: "Session index (oldest to newest)",
                    },
                },
            },
        },
    });
}