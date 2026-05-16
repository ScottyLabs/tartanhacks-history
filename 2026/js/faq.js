// Injects FAQs into the page because I am too lazy to do it by hand

const faqs = [
    {
        question: "Who runs TartanHacks?",
        answer: "TartanHacks is run by ScottyLabs, the premier software development club (and hackathon organizing team) at Carnegie Mellon University. ScottyLabs is not affiliated with any academic department (our students come from all majors!), and all of our funding for events like TartanHacks comes from corporate sponsors! While joining our organization is only open to CMU students, please reach out to us at hello@scottylabs.org if you have any questions about the work that we do."
    },
    {
        question: "How much does it cost to participate in TartanHacks?",
        answer: "Participating in TartanHacks is completely free for all undergrad + grad students! All merch and workshops are provided at no cost for participants."
    },
    {
        question: "Will TartanHacks provide travel reimbursements?",
        answer: "We are offering travel reimbursements to a select number of students this year. To apply for a travel reimbursement, submit your application and indicate you would like to apply for a reimbursement by Saturday, January 17th at the latest. Participants who are granted reimbursements will be notified the following week and will have 7 days to submit their travel itinerary and receipts to the TartanHacks team by Saturday, January 24th."
    },
    {
        question: "I'm not a Computer Science/Technical major, can I still join?",
        answer: "Yes! All undergraduate + graduate majors and programs, even if they aren't technical, are welcome and encouraged to participate in TartanHacks. We will provide access to hacker guides and slides from a series of web development workshops online that you can use to brush up your skills! We will also offer workshops during the event so you can get started with new frameworks."
    },
    {
        question: "Is TartanHacks open to first-year students?",
        answer: "Yes! Students of all skill levels are welcome to participate as long as they are a student. First-year students and first-time hackers have always been a part of TartanHacks so we would love to see you at the event! We also award specific prizes for beginner hackers."
    },
    {
        question: "Is housing provided for non-CMU hackers?",
        answer: "Unfortunately, we are unable to provide housing for participants. Students who stay up through the entire night will be allowed to continue hacking in the Cohon University Center. However, we do encourage participants to sleep as needed. Due to fire safety concerns, participants may not sleep in hallways or on the floor of the Cohon University Center. All non-CMU students should otherwise arrange their own housing for the night of Friday, February 6th, 2026."
    },
    {
        question: "Can I register with a team?",
        answer: "All participants will be required to register for TartanHacks as individuals, but there will be an opportunity to specify your team members before the event starts. If you already have a team chosen, you will be able to work with them."
    },
    {
        question: "If I don't have a team before the event, can I still participate?",
        answer: "Absolutely! We'll have a channel in the Discord server and a team mixer before the opening ceremony to help you meet new hackers and form a team."
    },
    {
        question: "How many people can we have per team?",
        answer: "Teams may have no more than 4 participants. Teammates are not strictly necessary, as students are allowed to participate as individuals."
    },
    {
        question: "Does everyone who registers get to participate at TartanHacks?",
        answer: "All CMU students are guaranteed admission. We expect that all registered from outside of CMU will be accepted, but we occasionally have more sign up than we can accommodate. Priority registration closes on Saturday, January 17th. Students from outside CMU will be notified via email about their admission status by Monday, January 19th."
    },
    {
        question: "Are we limited to software projects or are hardware projects allowed?",
        answer: "Hardware projects are absolutely allowed! However, be conscious of the amount of space that you need for the Judging Expo, as we can only guarantee so much room on each table for one team."
    },
    {
        question: "What resources will be provided to participants?",
        answer: "A thorough hacker guide (Google Doc and PDF) will be made available on the TartanHacks website at least one week before the event."
    },
    {
        question: "Will there be food?",
        answer: "Yes! There will be several meals provided at no cost to participants including a Friday dinner, Midnight sweet treat, and breakfast, lunch, and dinner on Saturday. We will offer vegan, vegetarian, gluten-free, halal and kosher options for those with dietary restrictions. Refreshments such as bottled water, coffee, and energy drinks will also be offered in limited quantities."
    }
];


// Two columns of FAQs, where each FAQ is a collapsible card
window.onload = () => {
    const rootElement = document.getElementById("faqs-content");
    for (let i = 0; i < faqs.length; i++) {
        const faq = faqs[i];
        const faqElement = document.createElement("div");
        faqElement.classList.add("faq");
        faqElement.innerHTML = `
            <div class="faq-qa">
                <div class="faq-question">
                    <h3>${faq.question}</h3>
                    <button class="faq-icon" onclick="toggleFAQ(${i})"><img src="./imgs/glass_+.png" alt="+" /></button>
                </div>
                <div class="faq-answer">
                    <p>${faq.answer}</p>
                </div>
            </div>`;
        rootElement.appendChild(faqElement);
        console.log(faqElement);
    }
};

function toggleFAQ(index) {
    const faqElement = document.getElementsByClassName("faq")[index];
    const answerElement = faqElement.getElementsByClassName("faq-answer")[0];
    const iconElement = faqElement.getElementsByClassName("faq-icon")[0];
    if (answerElement.style.display === "block") {
        answerElement.style.display = "none";
        iconElement.classList.remove("rotated");
    } else {
        answerElement.style.display = "block";
        iconElement.classList.add("rotated");
    }
}
