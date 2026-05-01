package com.example.demo;

import jakarta.annotation.PostConstruct;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.web.bind.annotation.CrossOrigin;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RestController;

import java.util.List;

@RestController
@CrossOrigin(origins = "*")
public class MessageController {

    @Autowired
    private MessageRepository messageRepository;

    @PostConstruct
    public void init() {
        if (messageRepository.count() == 0) {
            messageRepository.save(new Message("Hello from the Database!"));
            messageRepository.save(new Message("This message is fetched via Spring Data JPA."));
        }
    }

    @GetMapping("/")
    public String index() {
        List<Message> messages = messageRepository.findAll();
        if (messages.isEmpty()) {
            return "No messages found in DB.";
        }
        return messages.get(0).getText();
    }

    @GetMapping("/api/messages")
    public List<Message> getMessages() {
        return messageRepository.findAll();
    }

    @PostMapping("/api/messages")
    public Message createMessage(@RequestBody Message message) {
        return messageRepository.save(message);
    }
}
